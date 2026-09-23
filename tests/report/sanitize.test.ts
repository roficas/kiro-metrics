import { describe, it, expect } from "vitest";
import { escapeMarkdown, stripControl } from "../../src/report/formatters/sanitize.js";
import { formatDeveloperMarkdown, formatTeamMarkdown } from "../../src/report/formatters/markdown.js";
import { formatTeamTerminal } from "../../src/report/formatters/terminal.js";
import type { TeamReport } from "../../src/report/team.js";
import type { DeveloperReport } from "../../src/report/developer.js";

const hostile = "Alice\u001b[31m|<script>x</script>";

const report: TeamReport = {
  period: { since: "2026-08-01T00:00:00Z", until: "2026-08-31T00:00:00Z" },
  summary: {
    involvementRate: 50,
    authorshipRate: 40,
    deliveryFrequency: 2,
    totalCommits: 4,
    aiInvolvedCommits: 2,
    excluded: { botCommits: 0, unknownCommits: 0 },
  },
  byAuthor: [{ author: hostile, involvementRate: 50, authorshipRate: 40, commits: 4 }],
  topAiFiles: [{ file: "src/a|b.ts", authorshipRate: 100 }],
  weeklyTrend: [],
};

describe("sanitize", () => {
  it("strips ASCII and C1 control characters but keeps printable Unicode", () => {
    // The ESC byte goes; the now-inert "[31m" text is harmless and stays.
    expect(stripControl("a\u001b[31mb\u0007c\u0085d")).toBe("a[31mbcd");
    expect(stripControl("Zoë Ünal 日本")).toBe("Zoë Ünal 日本");
  });
  it("escapes Markdown table and HTML delimiters", () => {
    expect(escapeMarkdown("a|b<c>\\d")).toBe("a\\|b&lt;c&gt;\\\\d");
  });
  it("keeps hostile author names out of terminal escape sequences", () => {
    const out = formatTeamTerminal(report);
    expect(out).not.toContain("\u001b");
    expect(out).toContain("Alice");
  });
  it("keeps hostile author names and paths inside their Markdown cells", () => {
    const out = formatTeamMarkdown(report);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("<script>");
    expect(out).toContain("| Alice[31m\\|&lt;script&gt;x&lt;/script&gt; |");
  });
  it("escapes pipes in file paths and omits the email line when the log has none", () => {
    const dev: DeveloperReport = {
      author: "Alice",
      period: report.period,
      commits: { total: 1, aiInvolved: 1, involvementRate: 100 },
      lines: { ai: 10, human: 0, total: 10, authorshipRate: 100 },
      topAiFiles: [{ file: "src/a|b.ts", authorshipRate: 100 }],
    };
    const out = formatDeveloperMarkdown(dev);
    expect(out).toContain("**Author:** Alice\n");
    expect(out).toContain("| src/a\\|b.ts |");
  });
});
