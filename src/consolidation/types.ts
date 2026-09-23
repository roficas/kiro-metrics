/** Computed metrics output from the consolidation engine. */
export interface MetricsResult {
  period: {
    since: string;
    until: string;
  };
  summary: {
    /** Commits counted in the rates below, after exclusions. */
    totalCommits: number;
    aiInvolvedCommits: number;
    involvementRate: number; // percentage 0-100
    totalAiLines: number;
    totalHumanLines: number;
    authorshipRate: number; // percentage 0-100
    deliveryFrequency: number; // commits per week
    ctsSwProxy?: number; // cost per delivery unit (if hourly rate provided)
    /**
     * Commits removed from every rate, reported so the numbers stay reconcilable
     * against `git log`. Without these, totalCommits silently disagrees with history
     * and the report looks wrong rather than filtered.
     */
    excluded: {
      /** CI/bot commits. Machine-generated, so neither AI- nor human-authored. */
      botCommits: number;
      /** Commits carrying `ai-attribution: unknown` — unmeasurable, not human. */
      unknownCommits: number;
    };
  };
  byFile: Array<{
    file: string;
    aiLines: number;
    humanLines: number;
    authorshipRate: number;
  }>;
  byAuthor: Array<{
    author: string;
    /** Only when the log records emails (--with-email). */
    email?: string;
    totalCommits: number;
    aiInvolvedCommits: number;
    aiLines: number;
    humanLines: number;
  }>;
  weeklyTrend: Array<{
    weekStart: string; // ISO date (Monday)
    involvementRate: number;
    authorshipRate: number;
    commitCount: number;
  }>;
}

/** Options for the consolidation engine. */
export interface ConsolidationOptions {
  hourlyRate?: number; // developer hourly rate for CTS-SW calc
  hoursPerCommit?: number; // estimated hours per delivery unit (default: 2)
  /**
   * Include CI/bot commits in the rates. Default false.
   *
   * Bot commits are zero-line rows that only ever land in the human bucket, so they
   * drag involvement down by an amount proportional to pipeline activity rather than to
   * anything a developer did. Two CI systems writing attribution logs means the
   * distortion accumulates twice as fast as real work. Kept as an escape hatch for
   * reconciling against raw `git log` counts.
   */
  includeBots?: boolean;
}
