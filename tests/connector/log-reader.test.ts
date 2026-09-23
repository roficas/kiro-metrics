import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributionLogSource,
  isUrl,
  resolveToDate,
  parseLogEntry,
} from "../../src/connector/log-reader.js";

describe("isUrl", () => {
  it("recognizes http and https URLs", () => {
    expect(isUrl("https://raw.githubusercontent.com/o/r/main/metrics/attribution-log.jsonl")).toBe(true);
    expect(isUrl("http://example.com/log.jsonl")).toBe(true);
  });

  it("treats local paths as non-URLs", () => {
    expect(isUrl(".")).toBe(false);
    expect(isUrl("/abs/path")).toBe(false);
    expect(isUrl("./relative")).toBe(false);
    expect(isUrl("../parent")).toBe(false);
    expect(isUrl("owner/repo")).toBe(false);
  });
});

describe("resolveToDate", () => {
  it("passes an ISO date through", () => {
    expect(resolveToDate("2026-07-01").toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("resolves relative days into the past", () => {
    const now = Date.now();
    const result = resolveToDate("7d").getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    // Allow a small window for execution time
    expect(now - result).toBeGreaterThan(sevenDaysMs - 5000);
    expect(now - result).toBeLessThan(sevenDaysMs + 5000);
  });
});

describe("parseLogEntry", () => {
  const valid = {
    sha: "abc123",
    author: "Alice",
    email: "alice@example.com",
    date: "2026-08-01T10:00:00Z",
    message: "feat: something",
    trailers: {
      ai_authored_by: "kiro",
      ai_authorship: "assisted",
      ai_lines: 40,
      human_lines: 60,
    },
    notes: null,
  };

  it("parses a valid entry into CommitData", () => {
    const commit = parseLogEntry(valid, 1);
    expect(commit).not.toBeNull();
    expect(commit!.sha).toBe("abc123");
    expect(commit!.trailers.aiAuthoredBy).toBe("kiro");
    expect(commit!.trailers.aiAuthorship).toBe("assisted");
    expect(commit!.trailers.aiLines).toBe(40);
    expect(commit!.trailers.humanLines).toBe(60);
  });

  it("preserves a legitimate ai_lines of 0 (not coerced away)", () => {
    const commit = parseLogEntry(
      { ...valid, trailers: { ...valid.trailers, ai_lines: 0, human_lines: 100 } },
      1
    );
    expect(commit!.trailers.aiLines).toBe(0);
    expect(commit!.trailers.humanLines).toBe(100);
  });

  it("leaves authorEmail undefined when the log omits email (the default)", () => {
    const withoutEmail: Record<string, unknown> = { ...valid };
    delete withoutEmail["email"];
    const commit = parseLogEntry(withoutEmail, 1);
    expect(commit!.authorEmail).toBeUndefined();
    expect(parseLogEntry({ ...valid, email: "" }, 1)!.authorEmail).toBeUndefined();
    expect(parseLogEntry({ ...valid, email: null }, 1)!.authorEmail).toBeUndefined();
  });
  it("captures ai_attribution: unknown", () => {
    const commit = parseLogEntry(
      { ...valid, trailers: { ...valid.trailers, ai_attribution: "unknown" } },
      1
    );
    expect(commit!.trailers.aiAttribution).toBe("unknown");
  });

  it("ignores ai_attribution values other than unknown", () => {
    const commit = parseLogEntry(
      { ...valid, trailers: { ...valid.trailers, ai_attribution: "something" } },
      1
    );
    expect(commit!.trailers.aiAttribution).toBeUndefined();
  });

  it("rejects an entry with no sha", () => {
    const commit = parseLogEntry({ ...valid, sha: "" }, 1);
    expect(commit).toBeNull();
  });

  it("rejects an entry with an invalid date", () => {
    const commit = parseLogEntry({ ...valid, date: "not-a-date" }, 1);
    expect(commit).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(parseLogEntry("nope", 1)).toBeNull();
    expect(parseLogEntry(null, 1)).toBeNull();
  });

  it("passes through notes when present", () => {
    const commit = parseLogEntry(
      {
        ...valid,
        notes: {
          ai_lines: 40,
          human_lines: 60,
          total_lines: 100,
          ai_files: ["src/a.ts"],
          human_files: ["README.md"],
        },
      },
      1
    );
    expect(commit!.notes?.ai_files).toEqual(["src/a.ts"]);
  });
});

describe("AttributionLogSource — local", () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiro-metrics-"));
    warnSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  function writeLog(lines: string[]): string {
    const metricsDir = join(dir, "metrics");
    mkdirSync(metricsDir, { recursive: true });
    const file = join(metricsDir, "attribution-log.jsonl");
    writeFileSync(file, lines.join("\n") + "\n", "utf-8");
    return file;
  }

  const entry = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      sha: "s" + Math.random().toString(36).slice(2, 8),
      author: "Alice",
      email: "alice@example.com",
      date: "2026-08-01T10:00:00Z",
      message: "feat: x",
      trailers: {
        ai_authored_by: "kiro",
        ai_authorship: "assisted",
        ai_lines: 40,
        human_lines: 60,
      },
      notes: null,
      ...overrides,
    });

  it("reads all valid entries from a repo directory", async () => {
    writeLog([entry(), entry(), entry()]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({});
    expect(commits).toHaveLength(3);
  });

  it("skips malformed JSON lines but keeps valid ones", async () => {
    writeLog([entry(), "{ this is not json", entry()]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({});
    expect(commits).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("skips structurally invalid entries (missing sha)", async () => {
    writeLog([entry(), entry({ sha: "" })]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({});
    expect(commits).toHaveLength(1);
  });

  it("filters by author", async () => {
    writeLog([
      entry({ author: "Alice", email: "alice@example.com" }),
      entry({ author: "Bob", email: "bob@example.com" }),
    ]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({ author: "bob" });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.author).toBe("Bob");
  });

  it("filters by since date", async () => {
    writeLog([
      entry({ date: "2026-07-01T10:00:00Z" }),
      entry({ date: "2026-08-01T10:00:00Z" }),
    ]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({ since: "2026-07-15" });
    expect(commits).toHaveLength(1);
  });

  it("handles degraded notes (null) without error", async () => {
    writeLog([entry({ notes: null })]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({});
    expect(commits).toHaveLength(1);
    expect(commits[0]!.notes).toBeUndefined();
  });

  it("filters by author name when the log carries no email", async () => {
    writeLog([
      entry({ author: "Alice", email: undefined }),
      entry({ author: "Bob", email: undefined }),
    ]);
    const src = new AttributionLogSource(dir);
    const commits = await src.fetchCommits({ author: "alice" });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.author).toBe("Alice");
    expect(commits[0]!.authorEmail).toBeUndefined();
  });
  it("throws a clear error when the log is missing", async () => {
    const src = new AttributionLogSource(dir); // no log written
    await expect(src.fetchCommits({})).rejects.toThrow(/Attribution log not found/);
  });
});
describe("AttributionLogSource (remote)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["METRICS_TOKEN"];
  });
  it("refuses to send METRICS_TOKEN over plain http", async () => {
    process.env["METRICS_TOKEN"] = "secret";
    const src = new AttributionLogSource("http://example.com/metrics/attribution-log.jsonl");
    await expect(src.fetchCommits({})).rejects.toThrow(/insecure connection/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("sends the token as a Bearer header over https, with a timeout", async () => {
    process.env["METRICS_TOKEN"] = "secret";
    fetchSpy.mockResolvedValue(new Response("", { status: 200 }));
    const src = new AttributionLogSource("https://example.com/metrics/attribution-log.jsonl");
    await src.fetchCommits({});
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBe("Bearer secret");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("sends no Authorization header when no token is set", async () => {
    fetchSpy.mockResolvedValue(new Response("", { status: 200 }));
    const src = new AttributionLogSource("http://example.com/metrics/attribution-log.jsonl");
    await src.fetchCommits({});
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.headers["Authorization"]).toBeUndefined();
  });
  it("rejects a body larger than the size cap", async () => {
    fetchSpy.mockResolvedValue(
      new Response("x", { status: 200, headers: { "content-length": String(60 * 1024 * 1024) } })
    );
    const src = new AttributionLogSource("https://example.com/metrics/attribution-log.jsonl");
    await expect(src.fetchCommits({})).rejects.toThrow(/above the .* limit/);
  });
});
