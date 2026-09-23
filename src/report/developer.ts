/**
 * Developer view — personal attribution breakdown for a single contributor.
 */

import type { MetricsResult } from "../consolidation/types.js";

export interface DeveloperReport {
  author: string;
  /** Only when the log records emails (--with-email). */
  email?: string;
  period: { since: string; until: string };
  commits: { total: number; aiInvolved: number; involvementRate: number };
  lines: { ai: number; human: number; total: number; authorshipRate: number };
  topAiFiles: Array<{ file: string; authorshipRate: number }>;
}

/** Shape MetricsResult into a developer-focused report for a single author. */
export function buildDeveloperReport(
  metrics: MetricsResult,
  author?: string
): DeveloperReport {
  // Find the author in the byAuthor breakdown
  const authorData = author
    ? metrics.byAuthor.find(
        (a) =>
          a.author.toLowerCase() === author.toLowerCase() ||
          a.email?.toLowerCase() === author.toLowerCase()
      )
    : metrics.byAuthor[0]; // default to top contributor

  if (!authorData) {
    return {
      author: author ?? "unknown",
      period: metrics.period,
      commits: { total: 0, aiInvolved: 0, involvementRate: 0 },
      lines: { ai: 0, human: 0, total: 0, authorshipRate: 0 },
      topAiFiles: [],
    };
  }

  const totalLines = authorData.aiLines + authorData.humanLines;
  const authorshipRate =
    totalLines > 0
      ? Math.round((authorData.aiLines / totalLines) * 1000) / 10
      : 0;

  const involvementRate =
    authorData.totalCommits > 0
      ? Math.round(
          (authorData.aiInvolvedCommits / authorData.totalCommits) * 1000
        ) / 10
      : 0;

  // Top AI-authored files (from overall byFile — can't filter to author without more data)
  const topAiFiles = metrics.byFile
    .filter((f) => f.authorshipRate > 0)
    .slice(0, 10)
    .map((f) => ({ file: f.file, authorshipRate: f.authorshipRate }));

  return {
    author: authorData.author,
    email: authorData.email,
    period: metrics.period,
    commits: {
      total: authorData.totalCommits,
      aiInvolved: authorData.aiInvolvedCommits,
      involvementRate,
    },
    lines: {
      ai: authorData.aiLines,
      human: authorData.humanLines,
      total: totalLines,
      authorshipRate,
    },
    topAiFiles,
  };
}
