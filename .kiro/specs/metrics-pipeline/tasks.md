# Tasks: Metrics Reader Pipeline

## Phase 1: Foundation

### Task 1: Project restructure and dependencies
- [ ] Update `package.json` — remove Express/zod/uuid, add commander (CLI), node-fetch (GitHub API)
- [ ] Update `tsconfig.json` — include `scripts/` in compilation
- [ ] Run `npm install` and verify `npx tsc --noEmit` passes
- [ ] Create the `src/` directory structure per design.md

### Task 2: Shared types
- [ ] Create `src/connector/types.ts` with `CommitData` interface
- [ ] Create `src/consolidation/types.ts` with `MetricsResult` interface
- [ ] Create `src/report/types.ts` with report options types (view, format)

## Phase 2: Connector Layer

### Task 3: Local git connector
- [ ] Create `src/connector/local-git.ts` implementing `LocalGitSource`
- [ ] Parse git log output into `CommitData[]` (trailers from `%(trailers:...)` format)
- [ ] Read git notes from `ai-attribution` ref per commit
- [ ] Support `--since`, `--until`, `--author` filtering via git log flags
- [ ] Handle graceful degradation when notes ref doesn't exist
- [ ] Add tests in `tests/connector/local-git.test.ts` using fixture data

### Task 4: GitHub API connector
- [ ] Create `src/connector/github-api.ts` implementing `GitHubApiSource`
- [ ] Fetch commits from `/repos/{owner}/{repo}/commits` with pagination
- [ ] Parse trailers from commit message body
- [ ] Fetch git notes via refs/notes/ai-attribution (graceful if missing)
- [ ] Auth via GITHUB_TOKEN env var, clear error if missing
- [ ] Add tests in `tests/connector/github-api.test.ts` with mocked responses

### Task 5: Connector factory
- [ ] Create `src/connector/index.ts` — detects local path vs `owner/repo` format
- [ ] Returns appropriate source instance based on `--repo` flag value

## Phase 3: Consolidation Engine

### Task 6: Metric computation
- [ ] Create `src/consolidation/engine.ts`
- [ ] Implement `computeMetrics(commits: CommitData[], options): MetricsResult`
- [ ] AI Code Involvement Rate formula
- [ ] AI Code Authorship Rate formula (from trailers; enhanced with notes if available)
- [ ] Delivery frequency (commits per week over the period)
- [ ] CTS-SW proxy (if hourly rate provided via options)
- [ ] Per-file breakdown (aggregate from notes data)
- [ ] Per-author breakdown
- [ ] Weekly trend (group commits by ISO week, compute rates per week)
- [ ] Add tests in `tests/consolidation/engine.test.ts` with fixture CommitData[]

## Phase 4: Report Generator

### Task 7: Report renderers
- [ ] Create `src/report/developer.ts` — developer view data shaping
- [ ] Create `src/report/team.ts` — team view data shaping
- [ ] Create `src/report/board.ts` — board view data shaping
- [ ] Create `src/report/formatters/terminal.ts` — box-drawing terminal output
- [ ] Create `src/report/formatters/json.ts` — structured JSON output
- [ ] Create `src/report/formatters/markdown.ts` — markdown table output
- [ ] Add test in `tests/report/team.test.ts` verifying team view structure

## Phase 5: CLI and Integration

### Task 8: CLI entrypoint
- [ ] Create `src/index.ts` using commander for arg parsing
- [ ] Wire up: parse args → select connector → fetch commits → consolidate → render report
- [ ] Add `bin` field to package.json for `kiro-metrics` command
- [ ] Handle errors gracefully (no attribution data, auth missing, bad repo path)
- [ ] Exit code 0 on success, 1 on error

### Task 9: Integration test against real repo
- [ ] Create `tests/integration/real-repo.test.ts`
- [ ] Run the full pipeline against the current workspace repo
- [ ] Assert that it picks up the commits we've already tagged (the hooks commit)
- [ ] Verify involvement rate > 0 and authorship rate > 0

### Task 10: README and documentation
- [ ] Create `README.md` explaining: what this is, prerequisites, installation, usage examples
- [ ] Document the two-sided system: write side (hooks) + read side (pipeline)
- [ ] Include sample output for each view (developer, team, board)
- [ ] Link to the blog post and sample-kiro-coding-metrics-collector repo
- [ ] Document how to add hooks to your own project
