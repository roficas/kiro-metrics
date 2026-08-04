#!/usr/bin/env node
/**
 * kiro-metrics CLI entrypoint.
 * Reads AI code attribution data from git repos and produces four-tier metrics reports.
 */

import { Command } from "commander";
import { createConnector } from "./connector/index.js";
import { computeMetrics } from "./consolidation/engine.js";
import { generateReport } from "./report/index.js";
import type { ReportFormat, ReportView } from "./report/types.js";

const program = new Command();

program
  .name("kiro-metrics")
  .description(
    "CLI tool that reads AI code attribution data from git repos and produces four-tier metrics reports"
  )
  .version("0.1.0")
  .option("--repo <path-or-url>", "Local path or GitHub owner/repo", ".")
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
  .option("--format <format>", "Output format: terminal, json, md", "terminal")
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
      "\n  No commits found for the given filters.\n" +
        "  Tips:\n" +
        "    - Check the --since and --until range\n" +
        "    - Verify the --repo path is a git repository\n" +
        "    - If no attribution data exists, install the hooks first:\n" +
        "      ./scripts/hooks/install-hooks.sh\n"
    );
    process.exit(1);
  }

  // Check if any commits have attribution data
  const hasAttribution = commits.some(
    (c) => c.trailers.aiAuthoredBy !== undefined || c.notes !== undefined
  );

  if (!hasAttribution) {
    console.error(
      "\n  Warning: No AI attribution data found in the commit history.\n" +
        "  The metrics will show 0% involvement and authorship.\n" +
        "  To start collecting attribution data, install the hooks:\n" +
        "    ./scripts/hooks/install-hooks.sh\n"
    );
  }

  // Consolidate metrics
  const metrics = computeMetrics(commits, {
    hourlyRate: options.hourlyRate,
    hoursPerCommit: options.hoursPerCommit,
  });

  // Generate and output report
  const report = generateReport(metrics, { view, format, author: options.author });
  process.stdout.write(report + "\n");
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
  const valid: ReportFormat[] = ["terminal", "json", "md"];
  if (!valid.includes(input as ReportFormat)) {
    throw new Error(
      `Invalid format "${input}". Valid options: ${valid.join(", ")}`
    );
  }
  return input as ReportFormat;
}

program.parse();
