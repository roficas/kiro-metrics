/**
 * Sanitizers for untrusted strings in the plain-text formatters.
 *
 * Author names and file paths come from git history (or from a remote log the operator
 * pointed the CLI at), so they are attacker-controlled by anyone who can land a commit.
 * The HTML formatter escapes everything already; these cover the terminal and Markdown
 * outputs, which would otherwise pass ANSI escape sequences straight to the user's TTY
 * or let a `|` in a filename break a table and smuggle content into another cell.
 */

/**
 * Remove ASCII control characters (including ESC, so `\x1b[...` sequences cannot start)
 * and the C1 range. Printable Unicode is left alone: author names are frequently non-ASCII.
 */
export function stripControl(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/**
 * Make a value safe to place inside a Markdown table cell or inline text: no control
 * characters, pipes escaped so they cannot terminate the cell, and angle brackets
 * neutralised so renderers that allow inline HTML do not interpret them.
 */
export function escapeMarkdown(value: string): string {
  return stripControl(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
