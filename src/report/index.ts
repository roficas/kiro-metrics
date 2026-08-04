/**
 * Report module — builds the appropriate view and formats it for output.
 */

import type { MetricsResult } from "../consolidation/types.js";
import type { ReportOptions } from "./types.js";
import { buildDeveloperReport } from "./developer.js";
import { buildTeamReport } from "./team.js";
import { buildBoardReport } from "./board.js";
import {
  formatDeveloperTerminal,
  formatTeamTerminal,
  formatBoardTerminal,
} from "./formatters/terminal.js";
import {
  formatDeveloperJson,
  formatTeamJson,
  formatBoardJson,
} from "./formatters/json.js";
import {
  formatDeveloperMarkdown,
  formatTeamMarkdown,
  formatBoardMarkdown,
} from "./formatters/markdown.js";

/** Generate the full report string based on view and format options. */
export function generateReport(
  metrics: MetricsResult,
  options: ReportOptions
): string {
  switch (options.view) {
    case "developer":
      return formatDeveloper(metrics, options);
    case "team":
      return formatTeam(metrics, options);
    case "board":
      return formatBoard(metrics, options);
  }
}

function formatDeveloper(
  metrics: MetricsResult,
  options: ReportOptions
): string {
  const report = buildDeveloperReport(metrics, options.author);

  switch (options.format) {
    case "terminal":
      return formatDeveloperTerminal(report);
    case "json":
      return formatDeveloperJson(report);
    case "md":
      return formatDeveloperMarkdown(report);
  }
}

function formatTeam(metrics: MetricsResult, options: ReportOptions): string {
  const report = buildTeamReport(metrics);

  switch (options.format) {
    case "terminal":
      return formatTeamTerminal(report);
    case "json":
      return formatTeamJson(report);
    case "md":
      return formatTeamMarkdown(report);
  }
}

function formatBoard(metrics: MetricsResult, options: ReportOptions): string {
  const report = buildBoardReport(metrics);

  switch (options.format) {
    case "terminal":
      return formatBoardTerminal(report);
    case "json":
      return formatBoardJson(report);
    case "md":
      return formatBoardMarkdown(report);
  }
}
