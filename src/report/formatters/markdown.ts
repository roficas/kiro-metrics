/**
 * Markdown formatter — outputs the report as markdown tables for documentation or PRs.
 */

import type { DeveloperReport } from "../developer.js";
import type { TeamReport } from "../team.js";
import type { BoardReport } from "../board.js";

export function formatDeveloperMarkdown(report: DeveloperReport): string {
  const lines: string[] = [];

  lines.push(`# AI Attribution Report — Developer View`);
  lines.push("");
  lines.push(`**Author:** ${report.author} (${report.email})`);
  lines.push(
    `**Period:** ${report.period.since.slice(0, 10)} to ${report.period.until.slice(0, 10)}`
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total commits | ${report.commits.total} |`);
  lines.push(
    `| AI-involved commits | ${report.commits.aiInvolved} (${report.commits.involvementRate}%) |`
  );
  lines.push(
    `| AI-authored lines | ${report.lines.ai.toLocaleString()} / ${report.lines.total.toLocaleString()} (${report.lines.authorshipRate}%) |`
  );

  if (report.topAiFiles.length > 0) {
    lines.push("");
    lines.push("## Top AI-Authored Files");
    lines.push("");
    lines.push("| File | AI Authorship |");
    lines.push("|---|---|");
    for (const file of report.topAiFiles.slice(0, 10)) {
      lines.push(`| ${file.file} | ${file.authorshipRate}% |`);
    }
  }

  return lines.join("\n");
}

export function formatTeamMarkdown(report: TeamReport): string {
  const lines: string[] = [];

  lines.push(`# AI Attribution Report — Team View`);
  lines.push("");
  lines.push(
    `**Period:** ${report.period.since.slice(0, 10)} to ${report.period.until.slice(0, 10)}`
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| AI Code Involvement Rate | ${report.summary.involvementRate}% |`);
  lines.push(`| AI Code Authorship Rate | ${report.summary.authorshipRate}% |`);
  lines.push(
    `| Delivery Frequency | ${report.summary.deliveryFrequency} commits/week |`
  );
  lines.push(`| Commits Measured | ${report.summary.totalCommits} |`);
  if (report.summary.excluded.botCommits > 0) {
    lines.push(`| Excluded — bot commits | ${report.summary.excluded.botCommits} |`);
  }
  if (report.summary.excluded.unknownCommits > 0) {
    lines.push(
      `| Excluded — unmeasurable | ${report.summary.excluded.unknownCommits} |`
    );
  }

  if (report.byAuthor.length > 0) {
    lines.push("");
    lines.push("## By Author");
    lines.push("");
    lines.push("| Author | Involvement | Authorship | Commits |");
    lines.push("|---|---|---|---|");
    for (const author of report.byAuthor) {
      lines.push(
        `| ${author.author} | ${author.involvementRate}% | ${author.authorshipRate}% | ${author.commits} |`
      );
    }
  }

  if (report.weeklyTrend.length > 0) {
    lines.push("");
    lines.push("## Weekly Trend");
    lines.push("");
    lines.push("| Week | Involvement | Authorship | Commits |");
    lines.push("|---|---|---|---|");
    for (const week of report.weeklyTrend) {
      lines.push(
        `| ${week.weekStart} | ${week.involvementRate}% | ${week.authorshipRate}% | ${week.commitCount} |`
      );
    }
  }

  return lines.join("\n");
}

export function formatBoardMarkdown(report: BoardReport): string {
  const lines: string[] = [];

  lines.push(`# AI Metrics — Board Summary`);
  lines.push("");
  lines.push(
    `**Period:** ${report.period.since.slice(0, 10)} to ${report.period.until.slice(0, 10)}`
  );
  lines.push("");
  lines.push("## Headline Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(
    `| AI Code Involvement | ${report.headline.involvementRate}% of commits |`
  );
  lines.push(
    `| AI Code Authorship | ${report.headline.authorshipRate}% of lines |`
  );
  lines.push(
    `| Delivery Frequency | ${report.headline.deliveryFrequency} units/week |`
  );
  if (report.headline.ctsSwProxy !== undefined) {
    lines.push(
      `| CTS-SW Proxy | $${report.headline.ctsSwProxy}/delivery unit |`
    );
  }

  lines.push("");
  lines.push("## Trend");
  lines.push("");

  const invDir = report.trend.involvementChange >= 0 ? "+" : "";
  const authDir = report.trend.authorshipChange >= 0 ? "+" : "";
  lines.push(
    `- Involvement: ${invDir}${report.trend.involvementChange}pp`
  );
  lines.push(
    `- Authorship: ${authDir}${report.trend.authorshipChange}pp`
  );

  lines.push("");
  lines.push("## Guardrails");
  lines.push("");
  lines.push(`**Status:** ${report.guardrails.status}`);
  for (const note of report.guardrails.notes) {
    lines.push(`- ${note}`);
  }

  return lines.join("\n");
}
