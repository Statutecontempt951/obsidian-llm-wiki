/**
 * adapter-memu -- reads memU's Postgres backing store directly.
 *
 * memU's Python surface (MemuService / RetrieveMixin) is an internal workflow
 * orchestrator (async, LLM-gated, heavy config). Bridging it from Node via
 * subprocess is cold-start-per-call and hallucination-prone -- the prior
 * `from memu.app.retrieve import retrieve` assumption was never a public API.
 *
 * This adapter instead connects to the same Postgres the memU pipeline writes
 * into and serves two search paths:
 *   - text ILIKE on `summary` via `search()` -- always available
 *   - pgvector cosine similarity on `embedding` via `searchByVector()` --
 *     caller supplies the query vector; the adapter is model-agnostic
 *     (stored vectors are 1024-dim; matching them is the caller's problem)
 *
 * Requires: Postgres reachable via MEMU_DSN (default localhost:5432/memu),
 * `memory_items` table populated. pgvector extension is required only for
 * `searchByVector`; text search works without it.
 * Gracefully returns [] if the DB is unavailable or the query fails.
 */

import pg from "pg";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";

const { Pool } = pg;

export interface MemUAdapterConfig {
  /** Postgres DSN (default: env MEMU_DSN or localhost:5432/memu) */
  dsn?: string;
  /** user_id scope filter (default: env MEMU_USER_ID or "boris") */
  userId?: string;
  /** Maximum results per query (default: 20) */
  maxResults?: number;
  /** Query timeout in ms (default: 5000) */
  timeout?: number;
}

const DEFAULT_DSN = "postgresql://postgres:postgres@localhost:5432/memu";

export class MemUAdapter implements VaultMindAdapter {
  readonly name = "memu";
  readonly capabilities: readonly AdapterCapability[] = ["search", "embeddings"];

  private readonly dsn: string;
  private readonly userId: string;
  private readonly defaultMax: number;
  private readonly timeout: number;
  private pool: pg.Pool | null = null;
  private available = false;

  get isAvailable(): boolean { return this.available; }

  constructor(config?: MemUAdapterConfig) {
    this.dsn = config?.dsn ?? process.env.MEMU_DSN ?? DEFAULT_DSN;
    this.userId = config?.userId ?? process.env.MEMU_USER_ID ?? "boris";
    this.defaultMax = config?.maxResults ?? 20;
    this.timeout = config?.timeout ?? 5_000;
  }

  async init(): Promise<void> {
    try {
      this.pool = new Pool({
        connectionString: this.dsn,
        max: 2,
        connectionTimeoutMillis: 3_000,
        statement_timeout: this.timeout,
      });
      // Probe: confirm table + scope has data. Zero rows is a soft warning,
      // not a hard failure -- the DB might be fresh.
      const { rows } = await this.pool.query(
        "SELECT COUNT(*)::int AS n FROM memory_items WHERE user_id = $1",
        [this.userId],
      );
      const n = (rows[0]?.n as number) ?? 0;
      if (n === 0) {
        process.stderr.write(
          `obsidian-llm-wiki: [warn] memU PG reachable but 0 items for user_id=${this.userId}\n`,
        );
      }
      this.available = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [warn] memU PG unavailable (${msg}), adapter disabled\n`,
      );
      this.available = false;
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available || !this.pool) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    // Escape LIKE wildcards so user input like "50%" matches literally.
    const escaped = query
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;

    try {
      const { rows } = await this.pool.query<{
        id: string;
        summary: string;
        memory_type: string;
        user_id: string;
        created_at: Date;
      }>(
        `SELECT id, summary, memory_type, user_id, created_at
         FROM memory_items
         WHERE user_id = $1
           AND summary ILIKE $2 ESCAPE '\\'
         ORDER BY created_at DESC
         LIMIT $3`,
        [this.userId, pattern, limit],
      );

      return rows.map((r) => ({
        source: this.name,
        path: `memu/${r.user_id}/${r.memory_type}/${r.id}`,
        content: String(r.summary ?? "").slice(0, 500),
        // Text-ILIKE has no intrinsic relevance score. 0.5 keeps memu neutral
        // in the unified fusion layer; tune via adapter_weights if needed.
        score: 0.5,
        metadata: {
          memory_type: r.memory_type,
          user_id: r.user_id,
          created_at:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          item_id: r.id,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [error] memU PG query failed: ${msg}\n`,
      );
      return [];
    }
  }

  async searchByVector(
    vector: readonly number[],
    opts?: SearchOpts,
  ): Promise<SearchResult[]> {
    if (!this.available || !this.pool) return [];
    if (vector.length === 0) return [];
    const limit = Math.max(1, Math.min(opts?.maxResults ?? this.defaultMax, 100));
    // pgvector accepts vector literals as strings of the form '[1,2,3,...]'.
    // We cast on the server with ::vector to keep the driver side dim-agnostic.
    const vecLiteral = `[${vector.join(",")}]`;

    try {
      const { rows } = await this.pool.query<{
        id: string;
        summary: string;
        memory_type: string;
        user_id: string;
        created_at: Date;
        similarity: number;
      }>(
        `SELECT id, summary, memory_type, user_id, created_at,
                (1 - (embedding <=> $2::vector))::float8 AS similarity
         FROM memory_items
         WHERE user_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [this.userId, vecLiteral, limit],
      );

      return rows.map((r) => ({
        source: this.name,
        path: `memu/${r.user_id}/${r.memory_type}/${r.id}`,
        content: String(r.summary ?? "").slice(0, 500),
        // Cosine similarity. For unit vectors this is in [-1, 1]; for
        // unnormalised vectors it can exceed that range. Callers should
        // rely on ordering (higher = closer), not absolute magnitude.
        score: typeof r.similarity === "number" ? r.similarity : 0,
        metadata: {
          memory_type: r.memory_type,
          user_id: r.user_id,
          created_at:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
          item_id: r.id,
          cosine_similarity: r.similarity,
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `obsidian-llm-wiki: [error] memU PG vector query failed: ${msg}\n`,
      );
      return [];
    }
  }
}
