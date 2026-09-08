/**
 * Connector factory — every source is the same host-agnostic attribution-log reader.
 *
 * The only decision is where the log lives: a local path (repo dir or .jsonl file) or a
 * raw HTTP(S) URL. There is no per-host code — GitHub, GitLab, and self-hosted GitLab
 * are all just "a URL that serves the contract file."
 */

import type { CommitSource } from "./types.js";
import { AttributionLogSource } from "./log-reader.js";

/**
 * Create the data source for a `--repo` value.
 * Accepts a local path (default ".") or a raw URL to the attribution log.
 */
export function createConnector(repo: string): CommitSource {
  return new AttributionLogSource(repo);
}

export { AttributionLogSource, isUrl, LOG_RELATIVE_PATH } from "./log-reader.js";
export type { CommitData, CommitSource, ConnectorOptions } from "./types.js";
