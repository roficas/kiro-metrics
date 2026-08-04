/**
 * Team view — aggregate metrics for the whole team.
 */

import type { MetricsResult } from "../consolidation/types.js";

export interface TeamReport {
  period: { since: string; until: string };
  summary: {
    involvementRate: number;
    authorshipRate: number;
    deliveryFrequency: number;
    totalCommits: number;
    aiInvolvedCommits: number;
  };
  byAuthor: Array<{
    author: string;
    involvementRate: number;
    authorshipRate: number;
    commits: number;
  }>;
  topAiFiles: Array<{ file: string; authorshipRate: number }>;
  weeklyTrend: MetricsResult["weeklyTrend"];
}

/** Shape MetricsResult into a team-focused report. */
export function buildTeamReport(metrics: MetricsResult): TeamReport {
  const byAuthor = metrics.byAuthor.map((a) => {
    const totalLines = a.aiLines + a.humanLines;
    return {
      author: a.author,
      involvementRate:
        a.totalCommits > 0
          ? Math.round((a.aiInvolvedCommits / a.totalCommits) * 1000) / 10
          : 0,
      authorshipRate:
        totalLines > 0
          ? Math.round((a.aiLines / totalLines) * 1000) / 10
          : 0,
      commits: a.totalCommits,
    };
  });

  const topAiFiles = metrics.byFile
    .filter((f) => f.authorshipRate > 0)
    .slice(0, 10)
    .map((f) => ({ file: f.file, authorshipRate: f.authorshipRate }));

  return {
    period: metrics.period,
    summary: {
      involvementRate: metrics.summary.involvementRate,
      authorshipRate: metrics.summary.authorshipRate,
      deliveryFrequency: metrics.summary.deliveryFrequency,
      totalCommits: metrics.summary.totalCommits,
      aiInvolvedCommits: metrics.summary.aiInvolvedCommits,
    },
    byAuthor,
    topAiFiles,
    weeklyTrend: metrics.weeklyTrend,
  };
}
