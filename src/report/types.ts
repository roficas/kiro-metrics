/** Which audience the report targets. */
export type ReportView = "developer" | "team" | "board";

/** Output format for the report. */
export type ReportFormat = "terminal" | "json" | "md";

/** Options for report generation. */
export interface ReportOptions {
  view: ReportView;
  format: ReportFormat;
  author?: string; // required for developer view, filters to one person
}
