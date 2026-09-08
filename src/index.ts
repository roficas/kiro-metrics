#!/usr/bin/env node
/**
 * kiro-metrics CLI entrypoint.
 * Reads AI code attribution data from git repos and produces four-tier metrics reports.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { createConnector, isUrl } from "./connector/index.js";
import { computeMetrics } from "./consolidation/engine.js";
import { generateReport } from "./report/index.js";
import type { ReportFormat, ReportView } from "./report/types.js";

const program = new Command();

program
  .name("kiro-metrics")
  .description(
    "Reads the AI attribution log (metrics/attribution-log.jsonl) and produces four-tier metrics reports"
  )
  .version("0.1.0")
  .option(
    "--repo <path-or-url>",
    "Local repo/dir path, or a raw URL to metrics/attribution-log.jsonl",
    "."
  )
  .option(
    "--since <date>",
    "Start of date range (ISO date or relative: 30d, 3m)",
    "30d"
  )
  .option("--until <date>", "End of date range (ISO date)", "now")
  .option("--author <name>", "Filter to one contributor")
  .option(
    "--view <view>",
    "Report audience: developer, team, board",
    "team"
  )
  .option(
    "--format <format>",
    "Output format: terminal, json, md, html",
    "terminal"
  )
  .option(
    "--hourly-rate <rate>",
    "Developer hourly rate for CTS-SW calculation",
    parseFloat
  )
  .option(
    "--hours-per-commit <hours>",
    "Estimated hours per delivery unit (default: 2)",
    parseFloat
  )
  .option(
    "--include-bots",
    "Count CI/bot commits in the rates (excluded by default)",
    false
  )
  // Optional value: bare --out picks the conventional path, --out <file> overrides it,
  // and omitting it keeps stdout so piping to jq or a file still works unchanged.
  .option(
    "--out [path]",
    "Write to a file instead of stdout. Bare flag uses <repo>/metrics/reports/"
  )
  .action(async (options) => {
    try {
      await run(options);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      console.error(`\n  Error: ${message}\n`);
      process.exit(1);
    }
  });

interface CliOptions {
  repo: string;
  since: string;
  until: string;
  author?: string;
  view: string;
  format: string;
  hourlyRate?: number;
  hoursPerCommit?: number;
  includeBots?: boolean;
  /** true when --out was passed bare, a string when given a path, undefined when absent. */
  out?: boolean | string;
}

const FORMAT_EXTENSIONS: Record<ReportFormat, string> = {
  terminal: "txt",
  json: "json",
  md: "md",
  html: "html",
};

/**
 * A filesystem-safe run timestamp (YYYYMMDD-HHMMSS, UTC).
 *
 * Honours KIRO_METRICS_RUN_TS when set so a batch (report.sh all) that invokes the CLI
 * many times can pin one shared folder across all of them. Falls back to now otherwise.
 */
function runTimestamp(): string {
  const override = process.env["KIRO_METRICS_RUN_TS"];
  if (override && /^\d{8}-\d{6}$/.test(override)) return override;
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/** Turn a period into a compact, path-safe label like "2026-09-01_to_2026-09-08". */
function periodLabel(period: { since: string; until: string }): string {
  const since = period.since.slice(0, 10);
  const until = period.until.slice(0, 10);
  return `${since}_to_${until}`;
}

/**
 * Resolve where to write. Reports are generated output, so they belong beside the data
 * they summarise but must not be mistaken for it: metrics/attribution-log.jsonl is an
 * input maintained by CI, while metrics/reports/ is disposable and gitignored.
 *
 * Each run gets its own subfolder named "<runTimestamp>_<period>" so re-running with a
 * different window (or the same one) never overwrites an earlier report. Within a folder,
 * files are named by view alone (period is already in the folder name).
 */
function resolveOutputPath(
  out: boolean | string,
  repo: string,
  view: ReportView,
  format: ReportFormat,
  period: { since: string; until: string }
): string {
  if (typeof out === "string" && out.length > 0) return resolve(out);

  // Only a local checkout has a project root to write into; a remote URL does not.
  const root = isUrl(repo) ? process.cwd() : resolve(repo);
  const folder = `${runTimestamp()}_${periodLabel(period)}`;
  return join(
    root,
    "metrics",
    "reports",
    folder,
    `${view}.${FORMAT_EXTENSIONS[format]}`
  );
}

async function run(options: CliOptions): Promise<void> {
  // Validate view and format
  const view = validateView(options.view);
  const format = validateFormat(options.format);

  // Developer view requires an author
  if (view === "developer" && !options.author) {
    console.error(
      "\n  The --author flag is required for the developer view.\n" +
        "  Example: kiro-metrics --view developer --author \"Your Name\"\n"
    );
    process.exit(1);
  }

  // Create connector (local git or GitHub API)
  const connector = createConnector(options.repo);

  // Fetch commits
  const commits = await connector.fetchCommits({
    since: options.since,
    until: options.until !== "now" ? options.until : undefined,
    author: options.author,
  });

  if (commits.length === 0) {
    console.error(
      "\n  No entries found in the attribution log for the given filters.\n" +
        "  Tips:\n" +
        "    - Check the --since and --until range\n" +
        "    - Regenerate the log: ./scripts/backfill-attribution-log.sh\n" +
        "    - For a remote repo, verify the raw URL points to metrics/attribution-log.jsonl\n"
    );
    process.exit(1);
  }

  // Check if any entries carry attribution data
  const hasAttribution = commits.some(
    (c) => c.trailers.aiAuthoredBy !== undefined || c.notes !== undefined
  );

  if (!hasAttribution) {
    console.error(
      "\n  Warning: No AI attribution data found in the log.\n" +
        "  The metrics will show 0% involvement and authorship.\n" +
        "  To start collecting attribution data, install the hooks:\n" +
        "    ./scripts/hooks/install-hooks.sh\n"
    );
  }

  // Consolidate metrics
  const metrics = computeMetrics(commits, {
    hourlyRate: options.hourlyRate,
    hoursPerCommit: options.hoursPerCommit,
    includeBots: options.includeBots ?? false,
  });

  // Generate and output report
  const report = generateReport(metrics, { view, format, author: options.author });

  if (options.out === undefined || options.out === false) {
    process.stdout.write(report + "\n");
    return;
  }

  const target = resolveOutputPath(
    options.out,
    options.repo,
    view,
    format,
    metrics.period
  );
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, report + "\n", "utf-8");
  // Path goes to stderr so `--out` remains composable with shell redirection.
  console.error(`  Report written to ${target}`);
}

function validateView(input: string): ReportView {
  const valid: ReportView[] = ["developer", "team", "board"];
  if (!valid.includes(input as ReportView)) {
    throw new Error(
      `Invalid view "${input}". Valid options: ${valid.join(", ")}`
    );
  }
  return input as ReportView;
}

function validateFormat(input: string): ReportFormat {
  const valid: ReportFormat[] = ["terminal", "json", "md", "html"];
  if (!valid.includes(input as ReportFormat)) {
    throw new Error(
      `Invalid format "${input}". Valid options: ${valid.join(", ")}`
    );
  }
  return input as ReportFormat;
}

program.parse();
