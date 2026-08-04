/** Computed metrics output from the consolidation engine. */
export interface MetricsResult {
  period: {
    since: string;
    until: string;
  };
  summary: {
    totalCommits: number;
    aiInvolvedCommits: number;
    involvementRate: number; // percentage 0-100
    totalAiLines: number;
    totalHumanLines: number;
    authorshipRate: number; // percentage 0-100
    deliveryFrequency: number; // commits per week
    ctsSwProxy?: number; // cost per delivery unit (if hourly rate provided)
  };
  byFile: Array<{
    file: string;
    aiLines: number;
    humanLines: number;
    authorshipRate: number;
  }>;
  byAuthor: Array<{
    author: string;
    email: string;
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
}
