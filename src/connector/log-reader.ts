/**
 * Attribution log reader — the single, host-agnostic data source.
 *
 * Reads metrics/attribution-log.jsonl (the contract) from either:
 *   - a local path (a repo directory or a direct path to the .jsonl file)
 *   - a raw HTTP(S) URL (GitHub raw, GitLab raw, self-hosted GitLab — all identical)
 *
 * The tool never talks to a git-host API and never touches git. CI produces the
 * artifact; this reader consumes it. As long as the file matches the contract, the
 * source repo's host is irrelevant.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CommitData, CommitSource, ConnectorOptions } from "./types.js";

/** Conventional location of the contract artifact within a repo. */
export const LOG_RELATIVE_PATH = "metrics/attribution-log.jsonl";

/** One line of the contract. Mirrors what backfill-attribution-log.sh emits. */
interface AttributionLogEntry {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
  trailers: {
    ai_authored_by: string | null;
    ai_authorship: string | null;
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

/** Resolve a relative date ("30d", "3m", "1y") or ISO date to a Date. */
export function resolveToDate(input: string): Date {
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

/** True when the repo argument is an HTTP(S) URL rather than a local path. */
export function isUrl(repo: string): boolean {
  return /^https?:\/\//i.test(repo);
}

/**
 * Validate and convert one parsed JSONL object into a CommitData.
 * Returns null (with a warning) for malformed lines rather than throwing, so one bad
 * line cannot abort a whole report. A missing/invalid log is a separate, fatal error.
 */
export function parseLogEntry(raw: unknown, lineNumber: number): CommitData | null {
  if (typeof raw !== "object" || raw === null) {
    warnMalformed(lineNumber, "not a JSON object");
    return null;
  }

  const entry = raw as Partial<AttributionLogEntry>;

  if (typeof entry.sha !== "string" || entry.sha.length === 0) {
    warnMalformed(lineNumber, "missing 'sha'");
    return null;
  }
  if (typeof entry.date !== "string" || Number.isNaN(Date.parse(entry.date))) {
    warnMalformed(lineNumber, "missing or invalid 'date'");
    return null;
  }
  if (typeof entry.trailers !== "object" || entry.trailers === null) {
    warnMalformed(lineNumber, "missing 'trailers'");
    return null;
  }

  const t = entry.trailers;

  return {
    sha: entry.sha,
    author: typeof entry.author === "string" ? entry.author : "unknown",
    authorEmail: typeof entry.email === "string" ? entry.email : "",
    date: entry.date,
    message: typeof entry.message === "string" ? entry.message : "",
    trailers: {
      aiAuthoredBy: t.ai_authored_by ?? undefined,
      aiAuthorship: validAuthorship(t.ai_authorship),
      aiAttribution: t.ai_attribution === "unknown" ? "unknown" : undefined,
      // ?? not ||: a human-only commit legitimately has ai_lines: 0, and || would coerce
      // that 0 to undefined, dropping the commit's lines from the authorship denominator.
      aiLines: numberOrUndefined(t.ai_lines),
      humanLines: numberOrUndefined(t.human_lines),
    },
    notes: entry.notes ?? undefined,
  };
}

/**
 * The one data source. Point it at a local repo/file or a raw URL; it returns
 * CommitData[] parsed from the contract, filtered by the given options.
 */
export class AttributionLogSource implements CommitSource {
  private readonly location: string;

  constructor(location: string) {
    this.location = location;
  }

  async fetchCommits(options: ConnectorOptions): Promise<CommitData[]> {
    const content = isUrl(this.location)
      ? await this.readFromUrl(this.location)
      : this.readFromLocal(this.location);

    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    const since = options.since ? resolveToDate(options.since) : undefined;
    const until =
      options.until && options.until !== "now"
        ? resolveToDate(options.until)
        : undefined;

    const commits: CommitData[] = [];

    lines.forEach((line, i) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        warnMalformed(i + 1, "invalid JSON");
        return;
      }

      const commit = parseLogEntry(parsed, i + 1);
      if (!commit) return;

      const commitDate = new Date(commit.date);
      if (since && commitDate < since) return;
      if (until && commitDate > until) return;

      if (options.author) {
        const needle = options.author.toLowerCase();
        const matches =
          commit.author.toLowerCase().includes(needle) ||
          commit.authorEmail.toLowerCase().includes(needle);
        if (!matches) return;
      }

      commits.push(commit);
    });

    return commits;
  }

  /** Read the log from a local path (repo directory or direct file path). */
  private readFromLocal(location: string): string {
    let filePath = location;

    // If a directory was given, look for the conventional log path inside it.
    if (existsSync(location) && statSync(location).isDirectory()) {
      filePath = join(location, LOG_RELATIVE_PATH);
    }

    if (!existsSync(filePath)) {
      throw new Error(
        `Attribution log not found: ${filePath}\n` +
          "  Generate it with: ./scripts/backfill-attribution-log.sh\n" +
          "  Or set up CI (.github/workflows/attribution-log.yml or .gitlab-ci.yml)\n" +
          "  so it is produced automatically on push."
      );
    }

    return readFileSync(filePath, "utf-8");
  }

  /** Read the log from a raw HTTP(S) URL — host-agnostic. */
  private async readFromUrl(url: string): Promise<string> {
    const headers: Record<string, string> = {};

    // Optional auth for private repos. Host-agnostic: whatever token the user exports.
    const token = process.env["METRICS_TOKEN"];
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch attribution log from ${url}: ${detail}`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Access denied fetching ${url} (HTTP ${response.status}).\n` +
            "  For a private repo, export a token: export METRICS_TOKEN=<token>"
        );
      }
      if (response.status === 404) {
        throw new Error(
          `Attribution log not found at ${url} (HTTP 404).\n` +
            "  Verify the raw URL points to metrics/attribution-log.jsonl and that CI has run."
        );
      }
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
    }

    return response.text();
  }
}

function validAuthorship(
  value: string | null | undefined
): "generated" | "assisted" | "human-only" | undefined {
  if (!value) return undefined;
  if (["generated", "assisted", "human-only"].includes(value)) {
    return value as "generated" | "assisted" | "human-only";
  }
  return undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function warnMalformed(lineNumber: number, reason: string): void {
  console.error(
    `[kiro-metrics] Skipping malformed attribution log line ${lineNumber}: ${reason}`
  );
}
