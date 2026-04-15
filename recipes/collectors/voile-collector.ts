#!/usr/bin/env bun
/**
 * voile-collector.ts -- Voile (QQ+WeChat) -> vault digest
 *
 * Reads normalized messages from Voile's Postgres DB and writes
 * a dated digest to ~/.vault-mind/recipes/voile-to-vault/digests/.
 *
 * Usage:
 *   bun run recipes/collectors/voile-collector.ts
 *   VOILE_DB_URL=postgres://... bun run recipes/collectors/voile-collector.ts
 *
 * Environment:
 *   VOILE_DB_URL    - Postgres DSN (default: postgres://postgres:postgres@localhost:5432/voile)
 *   VOILE_CHANNELS  - optional comma-separated channel IDs; omit = auto-discover all
 *   VAULT_MIND_DIR  - optional project root override
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { sql } from 'bun';

// -- Types -------------------------------------------------------------------

interface MessageRow {
  id: number;
  channel_id: string;
  user_id: string;
  message_type: string;
  content: string;
  created_at: Date;
}

interface TopicRow {
  topic_label: string;
  cnt: string; // COUNT() returns string in Postgres
}

interface SentimentRow {
  label: string;
  cnt: string;
}

interface ChannelState {
  since_id: number;
  last_run?: string;
}

interface CollectorState {
  channels: Record<string, ChannelState>;
  last_run?: string;
}

interface CollectorStats {
  channels_scanned: number;
  channels_with_new: number;
  messages: number;
}

// -- Config ------------------------------------------------------------------

const DB_URL = process.env.VOILE_DB_URL ?? 'postgres://postgres:postgres@localhost:5432/voile';
const VOILE_CHANNELS_ENV = process.env.VOILE_CHANNELS; // optional

const OUTPUT_DIR = join(homedir(), '.vault-mind', 'recipes', 'voile-to-vault');
const DIGESTS_DIR = join(OUTPUT_DIR, 'digests');
const STATE_FILE = join(OUTPUT_DIR, 'state.json');
const HEARTBEAT_FILE = join(OUTPUT_DIR, 'heartbeat.jsonl');

const MAX_MESSAGES_PER_CHANNEL = 500; // fetch cap per channel per run
const DIGEST_TAIL = 30;               // messages shown per channel in digest

// -- Helpers -----------------------------------------------------------------

function ensureDirs(): void {
  for (const dir of [OUTPUT_DIR, DIGESTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function loadState(): CollectorState {
  if (!existsSync(STATE_FILE)) return { channels: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as CollectorState;
  } catch {
    return { channels: {} };
  }
}

function saveState(state: CollectorState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function appendHeartbeat(event: string, data: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, data }) + '\n';
  appendFileSync(HEARTBEAT_FILE, entry, 'utf8');
}

function hhmm(d: Date): string {
  return new Date(d).toISOString().slice(11, 16);
}

// -- DB queries --------------------------------------------------------------

type DB = typeof sql;

async function discoverChannels(db: DB): Promise<string[]> {
  const rows = await db<{ channel_id: string }[]>`
    SELECT DISTINCT channel_id FROM messages ORDER BY channel_id
  `;
  return rows.map(r => r.channel_id);
}

async function fetchMessages(db: DB, channelId: string, sinceId: number): Promise<MessageRow[]> {
  return db<MessageRow[]>`
    SELECT id, channel_id, user_id, message_type, content, created_at
    FROM messages
    WHERE channel_id = ${channelId}
      AND id > ${sinceId}
    ORDER BY id ASC
    LIMIT ${MAX_MESSAGES_PER_CHANNEL}
  `;
}

async function fetchTopics(db: DB, channelId: string): Promise<TopicRow[]> {
  try {
    return await db<TopicRow[]>`
      SELECT topic_label, COUNT(*)::text AS cnt
      FROM message_topics
      WHERE channel_id = ${channelId}
        AND created_at >= NOW() - INTERVAL '1 day'
      GROUP BY topic_label
      ORDER BY COUNT(*) DESC
      LIMIT 15
    `;
  } catch {
    return []; // table not yet populated -- skip gracefully
  }
}

async function fetchSentiment(db: DB, channelId: string): Promise<SentimentRow[]> {
  try {
    return await db<SentimentRow[]>`
      SELECT ms.label, COUNT(*)::text AS cnt
      FROM message_sentiments ms
      JOIN messages m ON m.message_id = ms.message_id
      WHERE m.channel_id = ${channelId}
        AND ms.created_at >= NOW() - INTERVAL '1 day'
      GROUP BY ms.label
    `;
  } catch {
    return []; // table not yet populated -- skip gracefully
  }
}

// -- Digest ------------------------------------------------------------------

function buildChannelBlock(
  channelId: string,
  messages: MessageRow[],
  topics: TopicRow[],
  sentiments: SentimentRow[],
): string[] {
  const lines: string[] = [
    `## Channel ${channelId} (${messages.length} new)`,
    '',
  ];

  if (topics.length > 0) {
    lines.push('### Topics', '');
    for (const { topic_label, cnt } of topics) {
      lines.push(`- ${topic_label} (${cnt}x)`);
    }
    lines.push('');
  }

  if (sentiments.length > 0) {
    const total = sentiments.reduce((s, r) => s + parseInt(r.cnt, 10), 0);
    lines.push('### Sentiment', '');
    for (const { label, cnt } of sentiments) {
      const n = parseInt(cnt, 10);
      const pct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
      lines.push(`- ${label}: ${n} (${pct}%)`);
    }
    lines.push('');
  }

  const tail = messages.slice(-DIGEST_TAIL);
  if (tail.length < messages.length) {
    lines.push(`*... ${messages.length - tail.length} earlier messages omitted ...*`, '');
  }
  lines.push('### Messages', '');
  for (const m of tail) {
    const time = hhmm(m.created_at);
    const text = m.content.replace(/\n/g, ' ').slice(0, 120);
    lines.push(`- [${time}] ${m.user_id}: ${text}`);
  }
  lines.push('');

  return lines;
}

function buildDigest(
  date: string,
  blocks: string[][],
  stats: CollectorStats,
): string {
  const frontmatter = [
    '---',
    `date: ${date}`,
    'source: voile-to-vault',
    'type: digest',
    `channels: ${stats.channels_with_new}`,
    `total_messages: ${stats.messages}`,
    '---',
    '',
    `# Chat Digest -- ${date}`,
    '',
  ];
  return [...frontmatter, ...blocks.flat()].join('\n');
}

// -- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  ensureDirs();
  const state = loadState();
  const stats: CollectorStats = { channels_scanned: 0, channels_with_new: 0, messages: 0 };

  // Connect to Voile DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = new (sql as any)(DB_URL) as DB;

  // Resolve channel list: specified > auto-discovered
  let channels: string[];
  try {
    if (VOILE_CHANNELS_ENV) {
      channels = VOILE_CHANNELS_ENV.split(',').map(s => s.trim()).filter(Boolean);
      process.stderr.write(`[voile-collector] Using specified channels: ${channels.join(', ')}\n`);
    } else {
      channels = await discoverChannels(db);
      process.stderr.write(`[voile-collector] Auto-discovered ${channels.length} channel(s)\n`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[voile-collector] ERROR: DB connect failed: ${msg}\n`);
    process.stderr.write('[voile-collector] Ensure Voile is running. Set VOILE_DB_URL if needed.\n');
    appendHeartbeat('error', { reason: 'db_connect', message: msg });
    process.exit(1);
  }

  if (channels.length === 0) {
    process.stderr.write('[voile-collector] No channels found -- nothing to do.\n');
    appendHeartbeat('skip', { reason: 'no_channels' });
    return;
  }

  // Per-channel fetch + checkpoint
  const blocks: string[][] = [];

  for (const channelId of channels) {
    stats.channels_scanned++;
    const chanState = state.channels[channelId] ?? { since_id: 0 };

    const messages = await fetchMessages(db, channelId, chanState.since_id);
    if (messages.length === 0) continue;

    const [topics, sentiments] = await Promise.all([
      fetchTopics(db, channelId),
      fetchSentiment(db, channelId),
    ]);

    blocks.push(buildChannelBlock(channelId, messages, topics, sentiments));

    const newestId = messages[messages.length - 1]!.id;
    state.channels[channelId] = { since_id: newestId, last_run: new Date().toISOString() };
    stats.messages += messages.length;
    stats.channels_with_new++;

    saveState(state); // checkpoint: safe to resume mid-run
  }

  if (stats.messages === 0) {
    process.stderr.write('[voile-collector] No new messages across all channels.\n');
    appendHeartbeat('noop', { channels_scanned: stats.channels_scanned });
    return;
  }

  // Write digest
  const today = new Date().toISOString().slice(0, 10);
  const content = buildDigest(today, blocks, stats);
  const digestPath = join(DIGESTS_DIR, `${today}.md`);
  writeFileSync(digestPath, content, 'utf8');

  state.last_run = new Date().toISOString();
  saveState(state);
  appendHeartbeat('sync', { stats, digest: digestPath });

  process.stderr.write(
    `[voile-collector] Done. channels=${stats.channels_with_new}/${stats.channels_scanned}` +
    ` messages=${stats.messages} digest=${digestPath}\n`,
  );
}

main().catch(err => {
  process.stderr.write(`[voile-collector] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
