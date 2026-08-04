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
    aiLines?: number;
    humanLines?: number;
  };
  notes?: {
    ai_lines: number;
    human_lines: number;
    total_lines: number;
    ai_files: string[];
    human_files: string[];
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
