/**
 * Unit tests for QmdAdapter.
 *
 * We don't assume qmd is installed on CI/dev machines, so tests use a
 * fake binary (a shell script / node script) fed via the `binary` option.
 * That keeps coverage meaningful without requiring qmd on PATH.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QmdAdapter } from "./qmd.js";

function makeFakeBinary(stdout: string, exitCode = 0): {
  path: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "qmd-fake-"));
  // Cross-platform: use a node script as the fake "binary".
  const binPath = join(dir, "fake-qmd.cjs");
  const encoded = JSON.stringify(stdout);
  const script =
    "#!/usr/bin/env node\n" +
    `process.stdout.write(${encoded});\n` +
    `process.exit(${exitCode});\n`;
  writeFileSync(binPath, script, { mode: 0o755 });
  try {
    chmodSync(binPath, 0o755);
  } catch {
    // Windows may not need chmod
  }
  return {
    path: binPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe("QmdAdapter", () => {
  it("isAvailable=false when binary missing (graceful degradation)", async () => {
    const adapter = new QmdAdapter({ binary: "definitely-not-a-real-binary-xyz123" });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });

  it("isAvailable=true when binary --version exits 0", async () => {
    // Node is always available; use node as a fake successful 'qmd --version'.
    const adapter = new QmdAdapter({ binary: process.execPath });
    await adapter.init();
    assert.equal(adapter.isAvailable, true);
    await adapter.dispose();
  });

  it("search() parses qmd --json output into SearchResult[]", async () => {
    const fakeOutput = JSON.stringify([
      {
        docid: "#abc123",
        score: 0.93,
        file: "notes/guide.md",
        line: 42,
        title: "Software Craftsmanship",
        context: "Work documentation",
        snippet: "This section covers the **craftsmanship** of building...",
      },
      {
        docid: "#def456",
        score: 0.81,
        file: "notes/meeting.md",
        title: "Weekly standup",
        snippet: "Discussed craftsmanship as a principle.",
      },
    ]);
    const fake = makeFakeBinary(fakeOutput, 0);
    try {
      // Drive node as the "binary", passing the fake script as its first arg.
      // Cross-platform: avoids Windows shebang limitations.
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("craftsmanship", { maxResults: 10 });
      assert.equal(results.length, 2);
      assert.equal(results[0].source, "qmd");
      assert.equal(results[0].path, "notes/guide.md");
      assert.equal(results[0].score, 0.93);
      assert.equal(results[0].content, "This section covers the **craftsmanship** of building...");
      assert.equal(results[0].metadata?.docid, "#abc123");
      assert.equal(results[0].metadata?.line, 42);
      assert.equal(results[1].content, "Discussed craftsmanship as a principle.");
    } finally {
      fake.cleanup();
    }
  });

  it("search() returns [] on invalid JSON", async () => {
    const fake = makeFakeBinary("this is not json", 0);
    try {
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("q");
      assert.deepEqual(results, []);
    } finally {
      fake.cleanup();
    }
  });

  it("search() returns [] on non-zero exit", async () => {
    const fake = makeFakeBinary("[]", 2);
    try {
      const adapter = new QmdAdapter({
        binary: process.execPath,
        binaryArgs: [fake.path],
      });
      (adapter as unknown as { _available: boolean })._available = true;
      const results = await adapter.search("q");
      assert.deepEqual(results, []);
    } finally {
      fake.cleanup();
    }
  });

  it("search() returns [] when not available (no subprocess spawn)", async () => {
    const adapter = new QmdAdapter();
    // _available stays false by default
    const results = await adapter.search("anything");
    assert.deepEqual(results, []);
  });
});
