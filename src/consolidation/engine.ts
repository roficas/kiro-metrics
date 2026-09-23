/**
 * Consolidation engine — computes all metrics from CommitData[].
 *
 * Formulas (from the blog post):
 *   AI Code Involvement Rate = (AI-touched commits / Total commits) x 100
 *   AI Code Authorship Rate  = (AI-authored lines / Total lines) x 100
 *   Delivery Frequency       = commits per week over the period
 *   CTS-SW Proxy             = (hourlyRate * hoursPerCommit * totalCommits) / deliveryUnits
 */

import type { CommitData } from "../connector/types.js";
import type { ConsolidationOptions, MetricsResult } from "./types.js";

/** Get the ISO Monday of the week a date falls in. */
export function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

/** Compute the number of weeks between two dates (minimum 1). */
export function weeksBetween(since: string, until: string): number {
  const start = new Date(since).getTime();
  const end = new Date(until).getTime();
  const diffMs = Math.abs(end - start);
  const weeks = diffMs / (7 * 24 * 60 * 60 * 1000);
  return Math.max(1, weeks);
}

/** Main consolidation function. */
/**
 * A commit is a bot commit if its author name carries the conventional `[bot]` suffix,
 * or its name or email matches a known CI identity. Matching on the name alone would
 * miss runners configured with a plain name; matching on email alone would miss forge
 * defaults — and the log omits email by default, so the name must be enough on its own.
 * Deliberately narrow: a false positive silently drops real work.
 */
const CI_IDENTITY = /^(github-actions|gitlab-ci|gitlab-ci-bot|dependabot|renovate)([-@[]|$)/i;

export function isBotCommit(commit: CommitData): boolean {
  if (/\[bot\]/i.test(commit.author)) return true;
  if (CI_IDENTITY.test(commit.author)) return true;
  return commit.authorEmail !== undefined && CI_IDENTITY.test(commit.authorEmail);
}

/** A commit whose attribution could not be measured, as opposed to being human-authored. */
export function isUnknownAttribution(commit: CommitData): boolean {
  return commit.trailers.aiAttribution === "unknown";
}

export function computeMetrics(
  commits: CommitData[],
  options: ConsolidationOptions = {}
): MetricsResult {
  const { hourlyRate, hoursPerCommit = 2, includeBots = false } = options;

  if (commits.length === 0) {
    return emptyResult();
  }

  // Partition before any arithmetic. Both excluded classes would otherwise land in the
  // human bucket and understate AI authorship: bot commits are machine-generated, and
  // `unknown` means capture failed, not that a human typed it.
  const botCommits = commits.filter(isBotCommit);
  const unknownCommits = commits.filter(
    (c) => !isBotCommit(c) && isUnknownAttribution(c)
  );
  const counted = commits.filter(
    (c) => (includeBots || !isBotCommit(c)) && !isUnknownAttribution(c)
  );

  const excluded = {
    botCommits: includeBots ? 0 : botCommits.length,
    unknownCommits: unknownCommits.length,
  };

  if (counted.length === 0) {
    return { ...emptyResult(), summary: { ...emptyResult().summary, excluded } };
  }

  // Sort by date ascending for trend computation
  const sorted = [...counted].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const since = sorted[0]!.date;
  const until = sorted[sorted.length - 1]!.date;

  // --- Summary metrics ---
  const totalCommits = sorted.length;
  const aiInvolvedCommits = sorted.filter(
    (c) => c.trailers.aiAuthoredBy !== undefined
  ).length;
  const involvementRate =
    totalCommits > 0 ? (aiInvolvedCommits / totalCommits) * 100 : 0;

  // Line-level authorship (from trailers or notes)
  let totalAiLines = 0;
  let totalHumanLines = 0;

  for (const commit of sorted) {
    // Prefer notes (more detailed), fall back to trailers
    if (commit.notes) {
      totalAiLines += commit.notes.ai_lines;
      totalHumanLines += commit.notes.human_lines;
    } else if (
      commit.trailers.aiLines !== undefined &&
      commit.trailers.humanLines !== undefined
    ) {
      totalAiLines += commit.trailers.aiLines;
      totalHumanLines += commit.trailers.humanLines;
    }
  }

  const totalLines = totalAiLines + totalHumanLines;
  const authorshipRate = totalLines > 0 ? (totalAiLines / totalLines) * 100 : 0;

  // Delivery frequency
  const weeks = weeksBetween(since, until);
  const deliveryFrequency = totalCommits / weeks;

  // CTS-SW proxy
  const ctsSwProxy = hourlyRate
    ? (hourlyRate * hoursPerCommit * totalCommits) / totalCommits
    : undefined;

  // --- Per-file breakdown ---
  const byFile = computeByFile(sorted);

  // --- Per-author breakdown ---
  const byAuthor = computeByAuthor(sorted);

  // --- Weekly trend ---
  const weeklyTrend = computeWeeklyTrend(sorted);

  return {
    period: { since, until },
    summary: {
      totalCommits,
      aiInvolvedCommits,
      involvementRate: round(involvementRate),
      totalAiLines,
      totalHumanLines,
      authorshipRate: round(authorshipRate),
      deliveryFrequency: round(deliveryFrequency),
      ctsSwProxy: ctsSwProxy !== undefined ? round(ctsSwProxy) : undefined,
      excluded,
    },
    byFile,
    byAuthor,
    weeklyTrend,
  };
}

function computeByFile(
  commits: CommitData[]
): MetricsResult["byFile"] {
  const fileMap = new Map<
    string,
    { aiLines: number; humanLines: number }
  >();

  for (const commit of commits) {
    if (!commit.notes) continue;

    for (const file of commit.notes.ai_files) {
      const entry = fileMap.get(file) ?? { aiLines: 0, humanLines: 0 };
      // Distribute AI lines evenly across AI files (approximation)
      entry.aiLines +=
        commit.notes.ai_files.length > 0
          ? Math.round(commit.notes.ai_lines / commit.notes.ai_files.length)
          : 0;
      fileMap.set(file, entry);
    }

    for (const file of commit.notes.human_files) {
      const entry = fileMap.get(file) ?? { aiLines: 0, humanLines: 0 };
      entry.humanLines +=
        commit.notes.human_files.length > 0
          ? Math.round(
              commit.notes.human_lines / commit.notes.human_files.length
            )
          : 0;
      fileMap.set(file, entry);
    }
  }

  return Array.from(fileMap.entries())
    .map(([file, data]) => {
      const total = data.aiLines + data.humanLines;
      return {
        file,
        aiLines: data.aiLines,
        humanLines: data.humanLines,
        authorshipRate: total > 0 ? round((data.aiLines / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.authorshipRate - a.authorshipRate);
}

function computeByAuthor(
  commits: CommitData[]
): MetricsResult["byAuthor"] {
  const authorMap = new Map<
    string,
    {
      email?: string;
      totalCommits: number;
      aiInvolvedCommits: number;
      aiLines: number;
      humanLines: number;
    }
  >();

  for (const commit of commits) {
    const key = commit.author;
    const entry = authorMap.get(key) ?? {
      email: commit.authorEmail,
      totalCommits: 0,
      aiInvolvedCommits: 0,
      aiLines: 0,
      humanLines: 0,
    };

    entry.totalCommits++;
    if (commit.trailers.aiAuthoredBy) entry.aiInvolvedCommits++;

    if (commit.notes) {
      entry.aiLines += commit.notes.ai_lines;
      entry.humanLines += commit.notes.human_lines;
    } else if (
      commit.trailers.aiLines !== undefined &&
      commit.trailers.humanLines !== undefined
    ) {
      entry.aiLines += commit.trailers.aiLines;
      entry.humanLines += commit.trailers.humanLines;
    }

    authorMap.set(key, entry);
  }

  return Array.from(authorMap.entries())
    .map(([author, data]) => ({ author, ...data }))
    .sort((a, b) => b.totalCommits - a.totalCommits);
}

function computeWeeklyTrend(
  commits: CommitData[]
): MetricsResult["weeklyTrend"] {
  const weekMap = new Map<
    string,
    { total: number; aiInvolved: number; aiLines: number; humanLines: number }
  >();

  for (const commit of commits) {
    const weekStart = getWeekStart(commit.date);
    const entry = weekMap.get(weekStart) ?? {
      total: 0,
      aiInvolved: 0,
      aiLines: 0,
      humanLines: 0,
    };

    entry.total++;
    if (commit.trailers.aiAuthoredBy) entry.aiInvolved++;

    if (commit.notes) {
      entry.aiLines += commit.notes.ai_lines;
      entry.humanLines += commit.notes.human_lines;
    } else if (
      commit.trailers.aiLines !== undefined &&
      commit.trailers.humanLines !== undefined
    ) {
      entry.aiLines += commit.trailers.aiLines;
      entry.humanLines += commit.trailers.humanLines;
    }

    weekMap.set(weekStart, entry);
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, data]) => {
      const totalLines = data.aiLines + data.humanLines;
      return {
        weekStart,
        involvementRate:
          data.total > 0 ? round((data.aiInvolved / data.total) * 100) : 0,
        authorshipRate:
          totalLines > 0 ? round((data.aiLines / totalLines) * 100) : 0,
        commitCount: data.total,
      };
    });
}

function emptyResult(): MetricsResult {
  return {
    period: { since: "", until: "" },
    summary: {
      totalCommits: 0,
      aiInvolvedCommits: 0,
      involvementRate: 0,
      totalAiLines: 0,
      totalHumanLines: 0,
      authorshipRate: 0,
      deliveryFrequency: 0,
      excluded: { botCommits: 0, unknownCommits: 0 },
    },
    byFile: [],
    byAuthor: [],
    weeklyTrend: [],
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
