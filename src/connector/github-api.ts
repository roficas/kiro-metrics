/**
 * GitHub API connector — reads commit attribution from the metrics/attribution-log.jsonl
 * file in a GitHub repository, or falls back to parsing commit messages directly.
 */

import type { CommitData, CommitSource, ConnectorOptions } from "./types.js";
import { parseTrailers } from "./local-git.js";

interface AttributionLogEntry {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
  trailers: {
    ai_authored_by: string | null;
    ai_authorship: string | null;
    /** Optional: logs written before this field existed omit it entirely. */
    ai_attribution?: string | null;
    ai_lines: number;
    human_lines: number;
  };
  notes: {
    ai_lines: number;
    human_lines: number;
    total_lines: number;
    ai_files: string[];
    human_files: string[];
    excluded_lines?: number;
    excluded_files?: string[];
  } | null;
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
}

/** Resolve a relative date to an ISO date string for filtering. */
function resolveToDate(input: string): Date {
  const match = input.match(/^(\d+)([dwmy])$/);
  if (!match) return new Date(input);

  const [, amount, unit] = match;
  const now = new Date();
  const n = parseInt(amount!, 10);

  switch (unit) {
    case "d":
      now.setDate(now.getDate() - n);
      break;
    case "w":
      now.setDate(now.getDate() - n * 7);
      break;
    case "m":
      now.setMonth(now.getMonth() - n);
      break;
    case "y":
      now.setFullYear(now.getFullYear() - n);
      break;
  }

  return now;
}

export class GitHubApiSource implements CommitSource {
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;

  constructor(ownerRepo: string) {
    const parts = ownerRepo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Invalid GitHub repo format: "${ownerRepo}". Expected "owner/repo".`
      );
    }
    this.owner = parts[0];
    this.repo = parts[1];

    const token = process.env["GITHUB_TOKEN"];
    if (!token) {
      throw new Error(
        "GITHUB_TOKEN environment variable is required for remote mode.\n" +
          "Set it with: export GITHUB_TOKEN=ghp_...\n" +
          "Or use: export GITHUB_TOKEN=$(gh auth token)"
      );
    }
    this.token = token;
  }

  async fetchCommits(options: ConnectorOptions): Promise<CommitData[]> {
    // Try attribution log first (has full data including notes)
    const logCommits = await this.fetchFromAttributionLog(options);
    if (logCommits.length > 0) {
      return logCommits;
    }

    // Fall back to parsing commit messages directly (no notes data)
    console.error(
      "[kiro-metrics] No attribution-log.jsonl found. Falling back to commit message parsing.\n" +
        "  For full data (including file-level breakdown), set up the GitHub Action:\n" +
        "  See: .github/workflows/attribution-log.yml\n"
    );
    return this.fetchFromCommitMessages(options);
  }

  /** Read from metrics/attribution-log.jsonl (full data including notes). */
  private async fetchFromAttributionLog(
    options: ConnectorOptions
  ): Promise<CommitData[]> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/metrics/attribution-log.jsonl`;
    const response = await this.request(url);

    if (!response.ok) {
      // File doesn't exist — that's fine, fall back
      return [];
    }

    const data = (await response.json()) as { content: string; encoding: string };
    if (data.encoding !== "base64") return [];

    const content = Buffer.from(data.content, "base64").toString("utf-8");
    const lines = content.trim().split("\n").filter((l) => l.length > 0);

    const since = options.since ? resolveToDate(options.since) : undefined;
    const until =
      options.until && options.until !== "now"
        ? resolveToDate(options.until)
        : undefined;

    const commits: CommitData[] = [];

    for (const line of lines) {
      const entry = JSON.parse(line) as AttributionLogEntry;
      const commitDate = new Date(entry.date);

      // Apply date filters
      if (since && commitDate < since) continue;
      if (until && commitDate > until) continue;

      // Apply author filter
      if (
        options.author &&
        !entry.author.toLowerCase().includes(options.author.toLowerCase()) &&
        !entry.email.toLowerCase().includes(options.author.toLowerCase())
      ) {
        continue;
      }

      const commit: CommitData = {
        sha: entry.sha,
        author: entry.author,
        authorEmail: entry.email,
        date: entry.date,
        message: entry.message,
        trailers: {
          aiAuthoredBy: entry.trailers.ai_authored_by ?? undefined,
          aiAuthorship: validAuthorship(entry.trailers.ai_authorship),
          aiAttribution:
            entry.trailers.ai_attribution === "unknown" ? "unknown" : undefined,
          // Use ?? not ||. A human-only commit legitimately has ai_lines: 0, and || would
          // coerce that 0 to undefined. The consolidation engine requires both aiLines and
          // humanLines to be defined before counting a commit, so the whole commit's lines
          // would be dropped from the authorship denominator — inflating the reported rate.
          aiLines: entry.trailers.ai_lines ?? undefined,
          humanLines: entry.trailers.human_lines ?? undefined,
        },
        notes: entry.notes ?? undefined,
      };

      commits.push(commit);
    }

    return commits;
  }

  /** Fall back to reading commit messages via GitHub API (no notes). */
  private async fetchFromCommitMessages(
    options: ConnectorOptions
  ): Promise<CommitData[]> {
    const commits: CommitData[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    const since = options.since ? resolveToDate(options.since).toISOString() : undefined;
    const until =
      options.until && options.until !== "now"
        ? resolveToDate(options.until).toISOString()
        : undefined;

    while (hasMore) {
      const url = this.buildCommitsUrl(page, perPage, since, until, options.author);
      const response = await this.request(url);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(
            "GitHub API rate limit exceeded. Wait or use a token with higher limits."
          );
        }
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as GitHubCommitResponse[];

      for (const item of data) {
        const trailers = parseTrailers(item.commit.message);
        const firstLine = item.commit.message.split("\n")[0] ?? "";

        commits.push({
          sha: item.sha,
          author: item.commit.author.name,
          authorEmail: item.commit.author.email,
          date: item.commit.author.date,
          message: firstLine,
          trailers,
          notes: undefined,
        });
      }

      hasMore = data.length === perPage;
      page++;
    }

    return commits;
  }

  private buildCommitsUrl(
    page: number,
    perPage: number,
    since?: string,
    until?: string,
    author?: string
  ): string {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });

    if (since) params.set("since", since);
    if (until) params.set("until", until);
    if (author) params.set("author", author);

    return `https://api.github.com/repos/${this.owner}/${this.repo}/commits?${params.toString()}`;
  }

  private async request(url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  }
}

function validAuthorship(
  value: string | null
): "generated" | "assisted" | "human-only" | undefined {
  if (!value) return undefined;
  if (["generated", "assisted", "human-only"].includes(value)) {
    return value as "generated" | "assisted" | "human-only";
  }
  return undefined;
}
