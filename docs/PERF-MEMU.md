# memU Adapter Perf Baseline

Measured 2026-04-29 against Curry's local stack:

- PG: `postgresql://postgres:postgres@localhost:5432/memu` (1059 active gm_nodes, 3087 edges)
- Embedding: ollama `qwen3-embedding:0.6b` (1024d) at `localhost:11434`
- memu-graph CLI: `D:/projects/memu-graph/.venv/Scripts/python.exe -m memu_graph.cli graph-recall`
- Adapter: `mcp-server/src/adapters/memu.ts` post C1 rewrite (commit 072b060)

## Result (n=20, query "openclaw")

| pool | p50 | p95 | p99 | mean | min | max |
| ---- | --- | --- | --- | ---- | --- | --- |
| cold (new adapter + init per query) | 637.9ms | 739.5ms | 739.5ms | 642.6ms | 622.8ms | 739.5ms |
| warm (init once, reused PG pool) | 638.3ms | 689.8ms | 689.8ms | 639.5ms | 623.3ms | 689.8ms |

Reproduce:

```bash
cd mcp-server
npm run build
node dist/scripts/memu-perf.js --iters 20 --query openclaw
```

## Latency budget (per call, warm path)

| Component | Cost | Notes |
| --------- | ---- | ----- |
| Python interpreter startup | ~200ms | venv at `D:/projects/memu-graph/.venv` (3.13.12) |
| `import memu_graph` (sqlalchemy + pydantic chain) | ~200ms | dominated by sqlalchemy lazy-resolver |
| PG connect | ~100ms | localhost, fresh connection per spawn |
| `load_graph` | ~42ms | reads gm_nodes + gm_edges into networkx-style dicts |
| `graph_recall` (PPR + LPA + dual-path merge) | ~90ms | PPR 20 iter + community detection + walk |
| ollama `qwen3-embedding:0.6b` for `search()` | ~80-100ms | only for `search(text)`, skipped for `searchByVector` |
| Node `spawn` overhead + JSON marshal | ~10ms | windowsHide, stdio piped, JSON parse |

Sum: ~640ms warm, matches measured p50.

## Why cold ≈ warm

PG pool init (3s timeout, but actual 30-150ms) is fully amortized after one
call. The dominant cost is the Python subprocess spawn, which fires fresh
on every `search()` regardless of pool state.

## When this becomes a problem

- 640ms is fine for "ask the agent a question" (one-shot retrieval).
- 640ms is borderline for chained / iterative search (5x = 3.2s blocks the user).
- 640ms is too slow for autocomplete-style flows.

## Optimization roadmap (deferred)

| Lever | Expected drop | Cost to implement |
| ----- | ------------- | ----------------- |
| Long-running daemon (stdio JSON-RPC) | 640 -> ~150ms (-77%) | 4-6h, requires lifecycle management |
| In-memory graph cache (skip `load_graph`) | -42ms | Trivial in daemon, blocked otherwise |
| Lazy `import memu_graph` (defer sqlalchemy chain) | -100ms | ~1h, refactor cli.py imports |
| Compiled Python via `nuitka` / `pyinstaller` | -200ms (interp startup) | high cost / fragile / not idiomatic |
| Skip ollama embed when caller has 1024d vec | -80ms | already implemented (`searchByVector`) |

Best ROI: stdio JSON-RPC daemon. Defer until interactive lag reported in
practice; spawn-per-call is acceptable MVP per Codex review.

## See also

- `mcp-server/_probe_memu.mjs` — end-to-end smoke test with assertions on
  `recall_path` / `ppr_score` / `community_id`.
- `mcp-server/src/scripts/memu-perf.ts` — the bench script itself.
- `D:/projects/memu-graph/src/memu_graph/cli.py` — stdin/stdout JSON bridge.
