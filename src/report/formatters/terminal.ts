/**
 * Terminal formatter — renders reports with box-drawing characters for readable CLI output.
 */

import type { DeveloperReport } from "../developer.js";
import type { TeamReport } from "../team.js";
import type { BoardReport } from "../board.js";

const BOX_TOP_LEFT = "\u256D";
const BOX_TOP_RIGHT = "\u256E";
const BOX_BOTTOM_LEFT = "\u2570";
const BOX_BOTTOM_RIGHT = "\u256F";
const BOX_HORIZONTAL = "\u2500";
const BOX_VERTICAL = "\u2502";
const BOX_T_LEFT = "\u251C";
const BOX_T_RIGHT = "\u2524";

function boxLine(width: number): string {
  return BOX_HORIZONTAL.repeat(width);
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function header(title: string, subtitle: string, width: number): string {
  const lines: string[] = [];
  lines.push(`${BOX_TOP_LEFT}${boxLine(width)}${BOX_TOP_RIGHT}`);
  lines.push(`${BOX_VERTICAL}  ${padRight(title, width - 2)}${BOX_VERTICAL}`);
  lines.push(`${BOX_VERTICAL}  ${padRight(subtitle, width - 2)}${BOX_VERTICAL}`);
  lines.push(`${BOX_T_LEFT}${boxLine(width)}${BOX_T_RIGHT}`);
  return lines.join("\n");
}

function footer(width: number): string {
  return `${BOX_BOTTOM_LEFT}${boxLine(width)}${BOX_BOTTOM_RIGHT}`;
}

function row(text: string, width: number): string {
  return `${BOX_VERTICAL}  ${padRight(text, width - 2)}${BOX_VERTICAL}`;
}

function emptyRow(width: number): string {
  return `${BOX_VERTICAL}${" ".repeat(width)}${BOX_VERTICAL}`;
}

export function formatDeveloperTerminal(report: DeveloperReport): string {
  const width = 50;
  const lines: string[] = [];

  lines.push(
    header(
      "AI Attribution Report \u2014 Developer View",
      `Author: ${report.author}  Period: ${formatPeriod(report.period)}`,
      width
    )
  );
  lines.push(row(`Your commits: ${report.commits.total}`, width));
  lines.push(
    row(
      `AI-involved: ${report.commits.aiInvolved} (${report.commits.involvementRate}%)`,
      width
    )
  );
  lines.push(
    row(
      `AI-authored lines: ${report.lines.ai.toLocaleString()} / ${report.lines.total.toLocaleString()} (${report.lines.authorshipRate}%)`,
      width
    )
  );

  if (report.topAiFiles.length > 0) {
    lines.push(emptyRow(width));
    lines.push(row("Top AI-authored files:", width));
    for (const file of report.topAiFiles.slice(0, 5)) {
      lines.push(row(`  ${file.file}  ${file.authorshipRate}% AI`, width));
    }
  }

  lines.push(footer(width));
  return lines.join("\n");
}

export function formatTeamTerminal(report: TeamReport): string {
  const width = 50;
  const lines: string[] = [];

  lines.push(
    header(
      "AI Attribution Report \u2014 Team View",
      `Period: ${formatPeriod(report.period)}`,
      width
    )
  );
  lines.push(
    row(`AI Code Involvement Rate:  ${report.summary.involvementRate}%`, width)
  );
  lines.push(
    row(`AI Code Authorship Rate:   ${report.summary.authorshipRate}%`, width)
  );
  lines.push(
    row(
      `Delivery Frequency:        ${report.summary.deliveryFrequency} commits/week`,
      width
    )
  );
  lines.push(
    row(`Commits measured:          ${report.summary.totalCommits}`, width)
  );
  // Rates are computed over a filtered set, so state the filtering. Otherwise
  // "Commits measured" silently disagrees with `git log` and the report looks broken.
  {
    const { botCommits, unknownCommits } = report.summary.excluded;
    const parts: string[] = [];
    if (botCommits > 0) parts.push(`${botCommits} bot`);
    if (unknownCommits > 0) parts.push(`${unknownCommits} unmeasurable`);
    if (parts.length > 0) {
      lines.push(row(`  excluded: ${parts.join(", ")}`, width));
    }
  }

  if (report.byAuthor.length > 0) {
    lines.push(emptyRow(width));
    lines.push(row("By Author:", width));
    for (const author of report.byAuthor) {
      lines.push(
        row(
          `  ${author.author}  ${author.involvementRate}% involvement, ${author.authorshipRate}% authorship`,
          width
        )
      );
    }
  }

  if (report.weeklyTrend.length > 0) {
    lines.push(emptyRow(width));
    lines.push(row("Weekly Trend:", width));
    for (const week of report.weeklyTrend.slice(-5)) {
      lines.push(
        row(
          `  ${week.weekStart}: involvement ${week.involvementRate}%  authorship ${week.authorshipRate}%`,
          width
        )
      );
    }
  }

  lines.push(footer(width));
  return lines.join("\n");
}

export function formatBoardTerminal(report: BoardReport): string {
  const width = 50;
  const lines: string[] = [];

  lines.push(
    header(
      "AI Metrics \u2014 Board Summary",
      `Period: ${formatPeriod(report.period)}`,
      width
    )
  );
  lines.push(
    row(
      `AI Code Involvement:   ${report.headline.involvementRate}% of commits`,
      width
    )
  );
  lines.push(
    row(
      `AI Code Authorship:    ${report.headline.authorshipRate}% of lines`,
      width
    )
  );
  lines.push(
    row(
      `Delivery Frequency:    ${report.headline.deliveryFrequency} units/week`,
      width
    )
  );
  if (report.headline.ctsSwProxy !== undefined) {
    lines.push(
      row(
        `CTS-SW Proxy:          $${report.headline.ctsSwProxy}/delivery unit`,
        width
      )
    );
  }

  lines.push(emptyRow(width));

  const invArrow = report.trend.involvementChange >= 0 ? "\u2191" : "\u2193";
  const authArrow = report.trend.authorshipChange >= 0 ? "\u2191" : "\u2193";
  lines.push(
    row(
      `Trend: ${invArrow} involvement ${report.trend.involvementChange > 0 ? "+" : ""}${report.trend.involvementChange}pp, ${authArrow} authorship ${report.trend.authorshipChange > 0 ? "+" : ""}${report.trend.authorshipChange}pp`,
      width
    )
  );

  lines.push(
    row(`Guardrail: ${report.guardrails.status}`, width)
  );
  for (const note of report.guardrails.notes) {
    lines.push(row(`  ${note}`, width));
  }

  lines.push(footer(width));
  return lines.join("\n");
}

function formatPeriod(period: { since: string; until: string }): string {
  const since = period.since.slice(0, 10);
  const until = period.until.slice(0, 10);
  return `${since} to ${until}`;
}
