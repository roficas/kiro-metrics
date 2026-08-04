import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  getWeekStart,
  weeksBetween,
} from "../../src/consolidation/engine.js";
import type { CommitData } from "../../src/connector/types.js";

describe("getWeekStart", () => {
  it("returns Monday for a Wednesday date", () => {
    // 2026-08-05 is a Wednesday
    expect(getWeekStart("2026-08-05T12:00:00Z")).toBe("2026-08-03");
  });

  it("returns same day for a Monday", () => {
    // 2026-08-03 is a Monday
    expect(getWeekStart("2026-08-03T12:00:00Z")).toBe("2026-08-03");
  });

  it("returns previous Monday for a Sunday", () => {
    // 2026-08-09 is a Sunday
    expect(getWeekStart("2026-08-09T12:00:00Z")).toBe("2026-08-03");
  });
});

describe("weeksBetween", () => {
  it("returns 1 for same day", () => {
    expect(weeksBetween("2026-08-01", "2026-08-01")).toBe(1);
  });

  it("returns ~4 for a month span", () => {
    const result = weeksBetween("2026-07-01", "2026-07-29");
    expect(result).toBeCloseTo(4, 0);
  });
});

describe("computeMetrics", () => {
  const baseCommit: CommitData = {
    sha: "abc123",
    author: "Dev",
    authorEmail: "dev@example.com",
    date: "2026-08-01T10:00:00Z",
    message: "feat: initial",
    trailers: {},
  };

  it("returns empty result for no commits", () => {
    const result = computeMetrics([]);
    expect(result.summary.totalCommits).toBe(0);
    expect(result.summary.involvementRate).toBe(0);
    expect(result.summary.authorshipRate).toBe(0);
  });

  it("computes involvement rate from trailers", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        trailers: { aiAuthoredBy: "kiro", aiAuthorship: "generated", aiLines: 100, humanLines: 0 },
      },
      {
        ...baseCommit,
        sha: "bbb",
        date: "2026-08-02T10:00:00Z",
        trailers: {},
      },
      {
        ...baseCommit,
        sha: "ccc",
        date: "2026-08-03T10:00:00Z",
        trailers: { aiAuthoredBy: "kiro", aiAuthorship: "assisted", aiLines: 50, humanLines: 50 },
      },
    ];

    const result = computeMetrics(commits);

    // 2 of 3 commits have aiAuthoredBy
    expect(result.summary.totalCommits).toBe(3);
    expect(result.summary.aiInvolvedCommits).toBe(2);
    expect(result.summary.involvementRate).toBeCloseTo(66.7, 0);
  });

  it("computes authorship rate from trailer lines", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        trailers: { aiAuthoredBy: "kiro", aiLines: 80, humanLines: 20 },
      },
      {
        ...baseCommit,
        sha: "bbb",
        date: "2026-08-02T10:00:00Z",
        trailers: { aiAuthoredBy: "kiro", aiLines: 60, humanLines: 40 },
      },
    ];

    const result = computeMetrics(commits);

    // Total AI: 140, Human: 60, Total: 200 → 70%
    expect(result.summary.totalAiLines).toBe(140);
    expect(result.summary.totalHumanLines).toBe(60);
    expect(result.summary.authorshipRate).toBe(70);
  });

  it("prefers notes over trailers for line counts", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        trailers: { aiAuthoredBy: "kiro", aiLines: 10, humanLines: 10 },
        notes: {
          ai_lines: 90,
          human_lines: 10,
          total_lines: 100,
          ai_files: ["src/main.ts"],
          human_files: ["README.md"],
        },
      },
    ];

    const result = computeMetrics(commits);

    // Should use notes (90/100 = 90%) not trailers (10/20 = 50%)
    expect(result.summary.totalAiLines).toBe(90);
    expect(result.summary.authorshipRate).toBe(90);
  });

  it("computes per-author breakdown", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        author: "Alice",
        authorEmail: "alice@example.com",
        trailers: { aiAuthoredBy: "kiro", aiLines: 100, humanLines: 0 },
      },
      {
        ...baseCommit,
        sha: "bbb",
        date: "2026-08-02T10:00:00Z",
        author: "Bob",
        authorEmail: "bob@example.com",
        trailers: {},
      },
      {
        ...baseCommit,
        sha: "ccc",
        date: "2026-08-03T10:00:00Z",
        author: "Alice",
        authorEmail: "alice@example.com",
        trailers: { aiAuthoredBy: "kiro", aiLines: 50, humanLines: 50 },
      },
    ];

    const result = computeMetrics(commits);

    expect(result.byAuthor).toHaveLength(2);
    const alice = result.byAuthor.find((a) => a.author === "Alice");
    expect(alice?.totalCommits).toBe(2);
    expect(alice?.aiInvolvedCommits).toBe(2);
    expect(alice?.aiLines).toBe(150);

    const bob = result.byAuthor.find((a) => a.author === "Bob");
    expect(bob?.totalCommits).toBe(1);
    expect(bob?.aiInvolvedCommits).toBe(0);
  });

  it("computes weekly trend", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        date: "2026-08-03T10:00:00Z", // Monday week 1
        trailers: { aiAuthoredBy: "kiro", aiLines: 50, humanLines: 50 },
      },
      {
        ...baseCommit,
        sha: "bbb",
        date: "2026-08-04T10:00:00Z", // Tuesday week 1
        trailers: {},
      },
      {
        ...baseCommit,
        sha: "ccc",
        date: "2026-08-10T10:00:00Z", // Monday week 2
        trailers: { aiAuthoredBy: "kiro", aiLines: 80, humanLines: 20 },
      },
    ];

    const result = computeMetrics(commits);

    expect(result.weeklyTrend).toHaveLength(2);
    expect(result.weeklyTrend[0]?.weekStart).toBe("2026-08-03");
    expect(result.weeklyTrend[0]?.commitCount).toBe(2);
    expect(result.weeklyTrend[0]?.involvementRate).toBe(50); // 1 of 2
    expect(result.weeklyTrend[1]?.weekStart).toBe("2026-08-10");
    expect(result.weeklyTrend[1]?.commitCount).toBe(1);
    expect(result.weeklyTrend[1]?.involvementRate).toBe(100); // 1 of 1
  });

  it("computes CTS-SW proxy when hourly rate provided", () => {
    const commits: CommitData[] = [
      { ...baseCommit, sha: "aaa", trailers: { aiAuthoredBy: "kiro" } },
      { ...baseCommit, sha: "bbb", date: "2026-08-02T10:00:00Z", trailers: {} },
    ];

    const result = computeMetrics(commits, { hourlyRate: 100, hoursPerCommit: 2 });

    // CTS-SW = (100 * 2 * 2) / 2 = 200
    expect(result.summary.ctsSwProxy).toBe(200);
  });

  it("computes per-file breakdown from notes", () => {
    const commits: CommitData[] = [
      {
        ...baseCommit,
        sha: "aaa",
        trailers: { aiAuthoredBy: "kiro" },
        notes: {
          ai_lines: 100,
          human_lines: 20,
          total_lines: 120,
          ai_files: ["src/engine.ts", "src/types.ts"],
          human_files: ["README.md"],
        },
      },
    ];

    const result = computeMetrics(commits);

    expect(result.byFile.length).toBeGreaterThan(0);
    const engineFile = result.byFile.find((f) => f.file === "src/engine.ts");
    expect(engineFile).toBeDefined();
    expect(engineFile!.aiLines).toBe(50); // 100 / 2 files
  });
});
