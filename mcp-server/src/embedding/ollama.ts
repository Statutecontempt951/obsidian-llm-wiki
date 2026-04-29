/**
 * Minimal Ollama embedding client.
 *
 * Calls Ollama's OpenAI-compatible /v1/embeddings endpoint to embed a query
 * string into a vector. The default model qwen3-embedding:0.6b returns
 * 1024-dim vectors which match Curry's gm_nodes schema (populated by
 * .memu/scripts/embed_nodes.py against the same model + endpoint).
 *
 * Zero npm deps -- uses Node 18+ built-in fetch.
 *
 * Failure modes: returns [] on network/HTTP/parse error and writes a
 * single-line warn to stderr. Caller decides whether to fall back to
 * lexical search.
 */

export interface OllamaEmbedOpts {
  /** Endpoint base URL. Default: env OLLAMA_EMBED_BASE_URL or http://localhost:11434/v1 */
  baseUrl?: string;
  /** Embedding model. Default: env OLLAMA_EMBED_MODEL or qwen3-embedding:0.6b */
  model?: string;
  /** Timeout in ms. Default: 30_000 */
  timeoutMs?: number;
}

const DEFAULT_BASE = "http://localhost:11434/v1";
const DEFAULT_MODEL = "qwen3-embedding:0.6b";

interface OpenAIEmbedResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export async function embedTextOllama(
  text: string,
  opts?: OllamaEmbedOpts,
): Promise<number[]> {
  if (!text || text.length === 0) return [];

  const baseUrl =
    opts?.baseUrl ?? process.env.OLLAMA_EMBED_BASE_URL ?? DEFAULT_BASE;
  const model = opts?.model ?? process.env.OLLAMA_EMBED_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: [text] }),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      process.stderr.write(
        `obsidian-llm-wiki: [warn] ollama embed HTTP ${resp.status}: ${errText.slice(0, 200)}\n`,
      );
      return [];
    }

    const json = (await resp.json()) as OpenAIEmbedResponse;
    const first = json.data?.[0];
    const vec = first?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      process.stderr.write(
        `obsidian-llm-wiki: [warn] ollama embed returned no vector\n`,
      );
      return [];
    }
    return vec;
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`obsidian-llm-wiki: [warn] ollama embed failed: ${msg}\n`);
    return [];
  }
}
