/**
 * JSON formatter — outputs the report as structured JSON for programmatic consumption.
 */

import type { DeveloperReport } from "../developer.js";
import type { TeamReport } from "../team.js";
import type { BoardReport } from "../board.js";

export function formatDeveloperJson(report: DeveloperReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatTeamJson(report: TeamReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatBoardJson(report: BoardReport): string {
  return JSON.stringify(report, null, 2);
}
