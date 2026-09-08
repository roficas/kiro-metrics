/** Raw commit data extracted by a connector (local git or GitHub API). */
export interface CommitData {
  sha: string;
  author: string;
  authorEmail: string;
  date: string; // ISO 8601
  message: string;
  trailers: {
    aiAuthoredBy?: string;
    aiAuthorship?: "generated" | "assisted" | "human-only";
    /**
     * Set to "unknown" by prepare-commit-msg when edit capture could not be verified,
     * meaning attribution for this commit is unmeasurable rather than human. Such
     * commits must be excluded from rate denominators; counting them as human is the
     * exact failure the marker exists to prevent.
     */
    aiAttribution?: "unknown";
    aiLines?: number;
    humanLines?: number;
  };
  notes?: {
    ai_lines: number;
    human_lines: number;
    /** ai_lines + human_lines. Excludes generated files — see excluded_lines. */
    total_lines: number;
    ai_files: string[];
    human_files: string[];
    /**
     * Lines in tool-generated files (lockfiles, build output, vendored code) that
     * pre-commit attributed to neither author. Deliberately outside total_lines so
     * generated content cannot dilute the authorship rate. Optional: notes written
     * before this field existed omit it.
     */
    excluded_lines?: number;
    excluded_files?: string[];
  };
}

/** Options passed to a connector to filter results. */
export interface ConnectorOptions {
  since?: string; // ISO date or relative (e.g. "30d")
  until?: string; // ISO date
  author?: string; // filter by name or email
}

/** Common interface all connectors implement. */
export interface CommitSource {
  fetchCommits(options: ConnectorOptions): Promise<CommitData[]>;
}
