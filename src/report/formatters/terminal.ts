/**
 * Terminal formatter — renders reports with box-drawing characters for readable CLI output.
 */

import type { DeveloperReport } from "../developer.js";
import type { TeamReport } from "../team.js";
import type { BoardReport } from "../board.js";
import { stripControl as clean } from "./sanitize.js";

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

/**
 * A fixed box width breaks the moment any content line — a long author name, file path,
 * or the "involvement X% authorship Y%" trend rows — exceeds it: padRight only pads, it
 * never truncates, so the border silently pushes outward and the box stops lining up.
 *
 * Instead each report builds its body as plain text lines first, measures the longest
 * one, and only then draws a box sized to fit — so every row's real content stays intact
 * rather than being cut off to preserve a cosmetic width. `minWidth` keeps small reports
 * from looking cramped.
 */
const MIN_CONTENT_WIDTH = 48;

/** A blank line inside the box body — distinct from "" so callers can't confuse it with
 * "no line" and accidentally drop it during width measurement. */
const BLANK = "";

function contentWidth(bodyLines: string[], title: string, subtitle: string): number {
  return Math.max(
    MIN_CONTENT_WIDTH,
    title.length,
    subtitle.length,
    ...bodyLines.map((l) => l.length)
  );
}

/** Render a complete box: top border, title/subtitle, divider, body rows, bottom border. */
function box(title: string, subtitle: string, bodyLines: string[]): string {
  const w = contentWidth(bodyLines, title, subtitle);
  const lines: string[] = [];
  lines.push(`${BOX_TOP_LEFT}${boxLine(w + 2)}${BOX_TOP_RIGHT}`);
  lines.push(`${BOX_VERTICAL}  ${padRight(title, w)}${BOX_VERTICAL}`);
  lines.push(`${BOX_VERTICAL}  ${padRight(subtitle, w)}${BOX_VERTICAL}`);
  lines.push(`${BOX_T_LEFT}${boxLine(w + 2)}${BOX_T_RIGHT}`);
  for (const text of bodyLines) {
    lines.push(
      text === BLANK
        ? `${BOX_VERTICAL}${" ".repeat(w + 2)}${BOX_VERTICAL}`
        : `${BOX_VERTICAL}  ${padRight(text, w)}${BOX_VERTICAL}`
    );
  }
  lines.push(`${BOX_BOTTOM_LEFT}${boxLine(w + 2)}${BOX_BOTTOM_RIGHT}`);
  return lines.join("\n");
}

export function formatDeveloperTerminal(report: DeveloperReport): string {
  const body: string[] = [];

  body.push(`Your commits: ${report.commits.total}`);
  body.push(
    `AI-involved: ${report.commits.aiInvolved} (${report.commits.involvementRate}%)`
  );
  body.push(
    `AI-authored lines: ${report.lines.ai.toLocaleString()} / ${report.lines.total.toLocaleString()} (${report.lines.authorshipRate}%)`
  );

  if (report.topAiFiles.length > 0) {
    body.push(BLANK);
    body.push("Top AI-authored files:");
    for (const file of report.topAiFiles.slice(0, 5)) {
      body.push(`  ${clean(file.file)}  ${file.authorshipRate}% AI`);
    }
  }

  return box(
    "AI Attribution Report \u2014 Developer View",
    `Author: ${clean(report.author)}  Period: ${formatPeriod(report.period)}`,
    body
  );
}

export function formatTeamTerminal(report: TeamReport): string {
  const body: string[] = [];

  body.push(`AI Code Involvement Rate:  ${report.summary.involvementRate}%`);
  body.push(`AI Code Authorship Rate:   ${report.summary.authorshipRate}%`);
  body.push(
    `Delivery Frequency:        ${report.summary.deliveryFrequency} commits/week`
  );
  body.push(`Commits measured:          ${report.summary.totalCommits}`);
  // Rates are computed over a filtered set, so state the filtering. Otherwise
  // "Commits measured" silently disagrees with `git log` and the report looks broken.
  {
    const { botCommits, unknownCommits } = report.summary.excluded;
    const parts: string[] = [];
    if (botCommits > 0) parts.push(`${botCommits} bot`);
    if (unknownCommits > 0) parts.push(`${unknownCommits} unmeasurable`);
    if (parts.length > 0) {
      body.push(`  excluded: ${parts.join(", ")}`);
    }
  }

  if (report.byAuthor.length > 0) {
    body.push(BLANK);
    body.push("By Author:");
    for (const author of report.byAuthor) {
      body.push(
        `  ${clean(author.author)}  ${author.involvementRate}% involvement, ${author.authorshipRate}% authorship`
      );
    }
  }

  if (report.weeklyTrend.length > 0) {
    body.push(BLANK);
    body.push("Weekly Trend:");
    for (const week of report.weeklyTrend.slice(-5)) {
      body.push(
        `  ${week.weekStart}: involvement ${week.involvementRate}%  authorship ${week.authorshipRate}%`
      );
    }
  }

  return box(
    "AI Attribution Report \u2014 Team View",
    `Period: ${formatPeriod(report.period)}`,
    body
  );
}

export function formatBoardTerminal(report: BoardReport): string {
  const body: string[] = [];

  body.push(`AI Code Involvement:   ${report.headline.involvementRate}% of commits`);
  body.push(`AI Code Authorship:    ${report.headline.authorshipRate}% of lines`);
  body.push(`Delivery Frequency:    ${report.headline.deliveryFrequency} units/week`);
  if (report.headline.ctsSwProxy !== undefined) {
    body.push(`CTS-SW Proxy:          $${report.headline.ctsSwProxy}/delivery unit`);
  }

  body.push(BLANK);

  const invArrow = report.trend.involvementChange >= 0 ? "\u2191" : "\u2193";
  const authArrow = report.trend.authorshipChange >= 0 ? "\u2191" : "\u2193";
  body.push(
    `Trend: ${invArrow} involvement ${report.trend.involvementChange > 0 ? "+" : ""}${report.trend.involvementChange}pp, ${authArrow} authorship ${report.trend.authorshipChange > 0 ? "+" : ""}${report.trend.authorshipChange}pp`
  );

  body.push(`Guardrail: ${report.guardrails.status}`);
  for (const note of report.guardrails.notes) {
    body.push(`  ${clean(note)}`);
  }

  return box(
    "AI Metrics \u2014 Board Summary",
    `Period: ${formatPeriod(report.period)}`,
    body
  );
}

function formatPeriod(period: { since: string; until: string }): string {
  const since = period.since.slice(0, 10);
  const until = period.until.slice(0, 10);
  return `${since} to ${until}`;
}
