/**
 * GitHub API connector — reads commit history and attribution data via GitHub REST API.
 */

import type { CommitData, CommitSource, ConnectorOptions } from "./types.js";
import { parseTrailers, resolveRelativeDate } from "./local-git.js";

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

/** Resolve a relative date to an ISO date string for the GitHub API. */
function resolveToISODate(input: string): string {
  const match = input.match(/^(\d+)([dwmy])$/);
  if (!match) return input;

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

  return now.toISOString();
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
          "Or authenticate with: gh auth login"
      );
    }
    this.token = token;
  }

  async fetchCommits(options: ConnectorOptions): Promise<CommitData[]> {
    const commits: CommitData[] = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    const since = options.since
      ? resolveToISODate(options.since)
      : undefined;
    const until =
      options.until && options.until !== "now"
        ? resolveToISODate(options.until)
        : undefined;

    while (hasMore) {
      const url = this.buildUrl(page, perPage, since, until, options.author);
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
          // Notes not easily accessible via GitHub API — graceful degradation
          notes: undefined,
        });
      }

      hasMore = data.length === perPage;
      page++;
    }

    return commits;
  }

  private buildUrl(
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
