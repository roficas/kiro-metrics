/**
 * Local git connector — reads commit history, trailers, and git notes from a local repo.
 */

import { execSync } from "node:child_process";
import type { CommitData, CommitSource, ConnectorOptions } from "./types.js";

const FIELD_SEPARATOR = "§§";
const RECORD_SEPARATOR = "§§§";

/** Parse a relative date string (e.g. "30d", "3m", "1y") into a git-compatible --since value. */
export function resolveRelativeDate(input: string): string {
  const match = input.match(/^(\d+)([dwmy])$/);
  if (!match) return input; // assume it's already an ISO date

  const [, amount, unit] = match;
  const units: Record<string, string> = {
    d: "days",
    w: "weeks",
    m: "months",
    y: "years",
  };

  return `${amount} ${units[unit!]} ago`;
}

/** Parse git trailers from a commit message body. */
export function parseTrailers(message: string): CommitData["trailers"] {
  const trailers: CommitData["trailers"] = {};

  const aiAuthoredBy = extractTrailer(message, "ai-authored-by");
  if (aiAuthoredBy) trailers.aiAuthoredBy = aiAuthoredBy;

  const aiAuthorship = extractTrailer(message, "ai-authorship");
  if (aiAuthorship && isValidAuthorship(aiAuthorship)) {
    trailers.aiAuthorship = aiAuthorship;
  }

  if (extractTrailer(message, "ai-attribution") === "unknown") {
    trailers.aiAttribution = "unknown";
  }

  // parseInt on a non-numeric trailer yields NaN, which would propagate silently into
  // every total and render the authorship rate NaN. Reject it here instead.
  const aiLines = extractTrailer(message, "ai-lines");
  if (aiLines !== undefined && Number.isInteger(Number(aiLines))) {
    trailers.aiLines = Number(aiLines);
  }

  const humanLines = extractTrailer(message, "human-lines");
  if (humanLines !== undefined && Number.isInteger(Number(humanLines))) {
    trailers.humanLines = Number(humanLines);
  }

  return trailers;
}

function extractTrailer(message: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = message.match(regex);
  return match?.[1]?.trim();
}

function isValidAuthorship(
  value: string
): value is "generated" | "assisted" | "human-only" {
  return ["generated", "assisted", "human-only"].includes(value);
}

/** Read git notes for a commit from the ai-attribution ref. */
export function readGitNotes(
  sha: string,
  repoPath: string
): CommitData["notes"] | undefined {
  try {
    const output = execSync(
      `git notes --ref=ai-attribution show ${sha}`,
      { cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (!output) return undefined;

    const parsed = JSON.parse(output) as CommitData["notes"];
    return parsed;
  } catch {
    // No note for this commit — that's fine
    return undefined;
  }
}

/** Check if the ai-attribution notes ref exists in the repo. */
export function hasNotesRef(repoPath: string): boolean {
  try {
    execSync("git notes --ref=ai-attribution list", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export class LocalGitSource implements CommitSource {
  private readonly repoPath: string;
  private readonly notesAvailable: boolean;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.notesAvailable = hasNotesRef(repoPath);
  }

  async fetchCommits(options: ConnectorOptions): Promise<CommitData[]> {
    const args = this.buildGitLogArgs(options);
    const format = [
      "%H",   // sha
      "%an",  // author name
      "%ae",  // author email
      "%aI",  // author date ISO
      "%B",   // full commit message (includes trailers)
    ].join(FIELD_SEPARATOR);

    const command = `git log --format="${format}${RECORD_SEPARATOR}" ${args.join(" ")}`;

    let output: string;
    try {
      output = execSync(command, {
        cwd: this.repoPath,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return [];
    }

    const records = output
      .split(RECORD_SEPARATOR)
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const commits: CommitData[] = [];

    for (const record of records) {
      const fields = record.split(FIELD_SEPARATOR);
      if (fields.length < 5) continue;

      const [sha, author, authorEmail, date, ...messageParts] = fields;
      const message = messageParts.join(FIELD_SEPARATOR).trim();

      const trailers = parseTrailers(message);

      // First line of message as the summary
      const firstLine = message.split("\n")[0] ?? "";

      const commit: CommitData = {
        sha: sha!,
        author: author!,
        authorEmail: authorEmail!,
        date: date!,
        message: firstLine,
        trailers,
      };

      // Read notes if available and commit has AI involvement
      if (this.notesAvailable) {
        const notes = readGitNotes(sha!, this.repoPath);
        if (notes) commit.notes = notes;
      }

      commits.push(commit);
    }

    return commits;
  }

  private buildGitLogArgs(options: ConnectorOptions): string[] {
    const args: string[] = [];

    if (options.since) {
      const resolved = resolveRelativeDate(options.since);
      args.push(`--since="${resolved}"`);
    }

    if (options.until && options.until !== "now") {
      args.push(`--until="${options.until}"`);
    }

    if (options.author) {
      args.push(`--author="${options.author}"`);
    }

    return args;
  }
}
