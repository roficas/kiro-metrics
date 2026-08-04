import { describe, it, expect } from "vitest";
import { parseTrailers, resolveRelativeDate } from "../../src/connector/local-git.js";

describe("resolveRelativeDate", () => {
  it("converts 30d to git-compatible format", () => {
    expect(resolveRelativeDate("30d")).toBe("30 days ago");
  });

  it("converts 3m to git-compatible format", () => {
    expect(resolveRelativeDate("3m")).toBe("3 months ago");
  });

  it("converts 1y to git-compatible format", () => {
    expect(resolveRelativeDate("1y")).toBe("1 years ago");
  });

  it("converts 2w to git-compatible format", () => {
    expect(resolveRelativeDate("2w")).toBe("2 weeks ago");
  });

  it("passes through ISO dates unchanged", () => {
    expect(resolveRelativeDate("2026-07-01")).toBe("2026-07-01");
  });

  it("passes through unrecognized formats unchanged", () => {
    expect(resolveRelativeDate("last monday")).toBe("last monday");
  });
});

describe("parseTrailers", () => {
  it("parses all attribution trailers from a commit message", () => {
    const message = `feat: add attribution hooks

Implements the PostToolUse hook for tracking AI edits.

ai-authored-by: kiro
ai-authorship: generated
ai-lines: 150
human-lines: 12`;

    const result = parseTrailers(message);

    expect(result.aiAuthoredBy).toBe("kiro");
    expect(result.aiAuthorship).toBe("generated");
    expect(result.aiLines).toBe(150);
    expect(result.humanLines).toBe(12);
  });

  it("parses assisted authorship", () => {
    const message = `fix: update config

ai-authored-by: kiro
ai-authorship: assisted
ai-lines: 40
human-lines: 60`;

    const result = parseTrailers(message);

    expect(result.aiAuthorship).toBe("assisted");
    expect(result.aiLines).toBe(40);
    expect(result.humanLines).toBe(60);
  });

  it("returns empty trailers for a human-only commit", () => {
    const message = "docs: update README\n\nFixed a typo in the installation section.";

    const result = parseTrailers(message);

    expect(result.aiAuthoredBy).toBeUndefined();
    expect(result.aiAuthorship).toBeUndefined();
    expect(result.aiLines).toBeUndefined();
    expect(result.humanLines).toBeUndefined();
  });

  it("handles human-only authorship tag", () => {
    const message = `chore: manual fix

ai-authorship: human-only`;

    const result = parseTrailers(message);

    expect(result.aiAuthoredBy).toBeUndefined();
    expect(result.aiAuthorship).toBe("human-only");
  });

  it("ignores invalid authorship values", () => {
    const message = `test: something

ai-authorship: invalid-value`;

    const result = parseTrailers(message);

    expect(result.aiAuthorship).toBeUndefined();
  });
});
