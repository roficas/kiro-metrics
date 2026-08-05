/**
 * Connector factory — selects LocalGitSource or GitHubApiSource based on the repo argument.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CommitSource } from "./types.js";
import { LocalGitSource } from "./local-git.js";
import { GitHubApiSource } from "./github-api.js";

/** Detect whether a repo argument is a local path or a GitHub owner/repo. */
export function isGitHubRepo(repo: string): boolean {
  // GitHub format: "owner/repo" without path separators beyond one slash
  // Local paths: start with /, ./, ../, ~, or contain multiple slashes
  if (repo.startsWith("/") || repo.startsWith("./") || repo.startsWith("../") || repo.startsWith("~")) {
    return false;
  }
  if (repo === ".") return false;

  const parts = repo.split("/");
  return parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0;
}

/** Create the appropriate connector based on the --repo flag value. */
export function createConnector(repo: string): CommitSource {
  if (isGitHubRepo(repo)) {
    return new GitHubApiSource(repo);
  }

  const resolvedPath = resolve(repo);

  // Verify it's a git repo
  if (!existsSync(resolve(resolvedPath, ".git"))) {
    throw new Error(
      `Not a git repository: "${resolvedPath}"\n` +
        "Pass a local path to a git repo or a GitHub owner/repo (e.g. roficas/kiro-metrics)."
    );
  }

  return new LocalGitSource(resolvedPath);
}

export { LocalGitSource } from "./local-git.js";
export { GitHubApiSource } from "./github-api.js";
export type { CommitData, CommitSource, ConnectorOptions } from "./types.js";
