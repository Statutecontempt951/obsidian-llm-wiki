/**
 * MemUAdapter tests.
 *
 * Two layers, matching qmd.test.ts philosophy ("don't assume the backend
 * is installed on CI/dev"):
 *
 *   1. Unavailable paths -- run unconditionally, no PG required. Covers the
 *      graceful-degradation contract: bad DSN, pre-init search, dispose
 *      safety, static capability/name shape.
 *
 *   2. Integration paths -- skipped unless MEMU_TEST_DSN is set. When set,
 *      these tests seed a small fixture into the target DB, exercise the
 *      real PG round-trip, and clean up after themselves. Use a throwaway
 *      database -- the `before()` block deletes and re-inserts rows for
 *      the test user_id scope.
 *
 * Example integration run:
 *   createdb memu_test
 *   MEMU_TEST_DSN=postgresql://postgres:postgres@localhost:5432/memu_test \
 *     MEMU_TEST_USER_ID=memu-adapter-test \
 *     npm run build && npm test
 */

import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MemUAdapter } from "./memu.js";

const TEST_DSN = process.env.MEMU_TEST_DSN;
const TEST_USER_ID = process.env.MEMU_TEST_USER_ID ?? "memu-adapter-test";
const OTHER_USER_ID = `${TEST_USER_ID}-other`;

// A DSN that resolves but refuses fast -- ECONNREFUSED on localhost:1.
const BAD_DSN = "postgresql://postgres@127.0.0.1:1/nonexistent";

describe("MemUAdapter -- unavailable paths", () => {
  test("bad DSN: init() resolves, isAvailable=false", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, userId: "nobody", timeout: 500 });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    await adapter.dispose();
  });

  test("search() returns [] when backend unavailable (no throw)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, userId: "nobody", timeout: 500 });
    await adapter.init();
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
    await adapter.dispose();
  });

  test("search() without init also returns [] (defensive)", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    // Deliberately skip init() -- adapter must still be safe.
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });

  test("dispose() is safe when never init'd", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN });
    await assert.doesNotReject(() => adapter.dispose());
  });

  test("dispose() is idempotent after failed init", async () => {
    const adapter = new MemUAdapter({ dsn: BAD_DSN, timeout: 500 });
    await adapter.init();
    await adapter.dispose();
    await assert.doesNotReject(() => adapter.dispose());
  });

  test("name is 'memu'", () => {
    const adapter = new MemUAdapter();
    assert.equal(adapter.name, "memu");
  });

  test("capabilities = ['search'] (memU is search-only for now)", () => {
    const adapter = new MemUAdapter();
    assert.deepEqual([...adapter.capabilities], ["search"]);
  });
});

describe(
  "MemUAdapter -- integration (requires MEMU_TEST_DSN)",
  { skip: TEST_DSN ? false : "MEMU_TEST_DSN not set" },
  () => {
    let adapter: MemUAdapter;

    before(async () => {
      // Seed fixture. Schema mirrors the columns memu.ts reads; extra columns
      // (e.g. embedding vector) are not required for ILIKE-path coverage.
      const pg = await import("pg");
      const pool = new pg.default.Pool({ connectionString: TEST_DSN });
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS memory_items (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            memory_type text NOT NULL,
            summary text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await pool.query(`DELETE FROM memory_items WHERE user_id = ANY($1::text[])`, [
          [TEST_USER_ID, OTHER_USER_ID],
        ]);
        await pool.query(
          `INSERT INTO memory_items (id, user_id, memory_type, summary, created_at) VALUES
             ($1, $2, 'profile', 'headless MCP server for LLM wiki pattern', now() - interval '3 minutes'),
             ($3, $2, 'project', 'memU adapter now reads Postgres directly',  now() - interval '2 minutes'),
             ($4, $2, 'project', '50% off sale ended yesterday literally',    now() - interval '1 minute'),
             ($5, $6, 'profile', 'row belongs to the other user, must be excluded', now())`,
          [
            `${TEST_USER_ID}-row-1`, TEST_USER_ID,
            `${TEST_USER_ID}-row-2`,
            `${TEST_USER_ID}-row-3`,
            `${TEST_USER_ID}-row-4`, OTHER_USER_ID,
          ],
        );
      } finally {
        await pool.end();
      }
    });

    beforeEach(async () => {
      adapter = new MemUAdapter({ dsn: TEST_DSN, userId: TEST_USER_ID });
      await adapter.init();
    });

    afterEach(async () => {
      await adapter.dispose();
    });

    test("init() flips isAvailable=true against real PG", () => {
      assert.equal(adapter.isAvailable, true);
    });

    test("search() returns rows scoped to user_id with correct shape", async () => {
      const results = await adapter.search("adapter");
      assert.ok(results.length >= 1, `expected >=1 result, got ${results.length}`);
      for (const r of results) {
        assert.equal(r.source, "memu");
        assert.equal(r.score, 0.5, "ILIKE is non-scored, adapter returns neutral 0.5");
        assert.equal(r.metadata?.user_id, TEST_USER_ID);
        assert.ok(r.path.startsWith(`memu/${TEST_USER_ID}/`));
        assert.ok(typeof r.metadata?.created_at === "string");
      }
    });

    test("search() orders by created_at DESC (newest first)", async () => {
      // All three seed rows for TEST_USER_ID contain the letter 'e' somewhere.
      const results = await adapter.search("e", { maxResults: 10 });
      assert.ok(results.length >= 2);
      const timestamps = results.map((r) => String(r.metadata?.created_at));
      const sorted = [...timestamps].sort().reverse();
      assert.deepEqual(timestamps, sorted, "results must be DESC by created_at");
    });

    test("search() excludes rows for other user_ids", async () => {
      // 'excluded' only appears in the OTHER_USER_ID row.
      const results = await adapter.search("excluded");
      assert.equal(results.length, 0);
    });

    test("search() respects maxResults cap", async () => {
      const results = await adapter.search("e", { maxResults: 1 });
      assert.equal(results.length, 1);
    });

    test("search() maxResults is clamped to [1, 100]", async () => {
      // Negative / zero should not explode -- adapter clamps to 1.
      const one = await adapter.search("e", { maxResults: 0 });
      assert.ok(one.length <= 1);
      // Over-limit should not error -- clamp to 100.
      const many = await adapter.search("e", { maxResults: 9999 });
      assert.ok(Array.isArray(many));
    });

    test("search() escapes % so literal '50%' matches", async () => {
      const results = await adapter.search("50%");
      assert.ok(
        results.some((r) => r.content.includes("50%")),
        "expected the '50% off' row to match a literal 50% query",
      );
    });

    test("search() escapes _ so literal underscores are not treated as wildcards", async () => {
      // Seed does not contain '_', so a query of '_' must not match every row.
      const results = await adapter.search("____zzz_does_not_exist");
      assert.equal(results.length, 0);
    });

    test("search() truncates content to 500 chars", async () => {
      const results = await adapter.search("adapter");
      for (const r of results) {
        assert.ok(r.content.length <= 500);
      }
    });

    test("search() returns empty array (not null) for no matches", async () => {
      const results = await adapter.search("zzz-absolutely-not-in-the-fixture-zzz");
      assert.deepEqual(results, []);
    });
  },
);
