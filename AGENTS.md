# Repository Guidelines

These rules supplement inherited instructions, including the dependency-installation policy.

## Agent worktrees and human review

- Use a separate worktree and branch for each agent task. Preserve other tasks'
  checkouts and uncommitted work.
- Create worktrees in visible sibling directories beside this repository so they
  can be opened in VS Code. Never create them under `/private` or `/tmp` (which
  resolves to `/private/tmp` on macOS). If sandbox permissions block the sibling
  directory, request access rather than falling back to a temporary directory.
- New worktrees have no `node_modules`. With install approval, run the full
  frozen-lockfile install before filtered `pnpm --filter ... add` commands, which
  set up only the filtered package and break cross-package imports in checks.
- Open a PR against `main` for human review; address feedback on the same task
  branch. Leave merging to the human unless explicitly instructed otherwise.
- Clean up task resources only after verifying the PR is merged and that no
  uncommitted work or later commits would be lost.

## Commit messages

- Use Conventional Commits: `<type>[optional scope][!]: <description>`.
- Choose a type that matches the change, such as `feat`, `fix`, `docs`, `refactor`,
  `test`, `build`, `ci`, or `chore`. Keep the description concise and imperative.
- Use `!` or a `BREAKING CHANGE:` footer for breaking changes.
- Examples: `fix(ingestion): preserve database error details` and
  `docs: require conventional commit messages`.

## Documentation updates

- After every change, review and update the relevant documentation in the same
  task, without waiting for a separate request. Documentation is part of completion.
- Keep behavior, commands, configuration, limits, examples and operational guidance
  consistent with the final implementation. Remove or correct superseded claims.
- Update existing documentation rather than duplicating it; keep it concise and
  verify affected links. Record significant changes and validation in `TASKS.md`.
- Include the current timestamp and timezone in every new `TASKS.md` section
  heading, using `## YYYY-MM-DD HH:mm UTC — Section title` (convert to UTC).
- If no documentation update is needed, state that briefly in the handoff.

## Deployment documentation

- The existing Lambda is managed in the AWS console, including manually set
  environment variables. `pnpm upload:ingestion` updates ingestion code and the CA
  certificate only; the retained CloudFormation template is undeployed, and CDK is not in use.
- Keep current operations distinct from proposed infrastructure and historical
  TASKS.md entries. Verify behavior against code before documenting it as active.

## Continuous Self-Improvement

Treat every task as an opportunity to improve future work in this repository.

After completing a task, encountering an unexpected issue, or receiving a correction:

1. **Reflect:** Identify any mistakes, incorrect assumptions, repeated inefficiencies, or newly discovered project conventions.
2. **Generalize:** Extract the underlying lesson rather than documenting only the specific incident.
3. **Persist:** If the lesson is likely to be useful in future tasks, update the relevant section of `AGENTS.md` with a concise, actionable instruction.
4. **Deduplicate:** Before adding a rule, check whether an existing instruction already covers it. Prefer refining existing rules over adding redundant ones.
5. **Validate:** Ensure new instructions are consistent with the codebase, existing conventions, and other instructions.

Guidelines:

- Do not wait for the user to explicitly request documentation updates.
- Prefer specific, actionable rules over vague advice.
- Record repository-specific discoveries, not generic programming knowledge.
- Do not turn one-off incidents into permanent rules unless they reveal a recurring or important failure mode.
- Keep `AGENTS.md` concise, organized, and free of outdated instructions.
- `CLAUDE.md` only imports `AGENTS.md`; put all instruction changes in `AGENTS.md`.
- Never weaken existing safety, testing, or quality requirements to make a task easier.

The goal is to become more effective at working in this repository with every completed task.

## Naming

- Choose filenames that describe both the subject and the file's specific role.
  Prefer `source-validation.ts` over a bare plural such as `sources.ts` for validation
  helpers. Avoid vague names such as `utils.ts` or `helpers.ts` for focused behavior.
- Name dedicated CLI entry points `<action>-<entity>.cli.ts` (for example,
  `add-source.cli.ts`). Keep CLI execution and terminal output separate from
  reusable registration/workflow logic in a separately named module.
- Use `.interface.ts` for files dedicated to behavioral contracts and name concrete
  implementations for their backing technology (for example, `postgres-ingestion-store.ts`).
  Keep data shapes in `models.ts`; internal modules import their owners directly,
  while package consumers use the public `index.ts` exports.

## Priorities

- Follow KISS (Keep It Simple, Stupid): choose the simplest solution that meets current
  requirements safely and correctly. Prioritize readability and maintainability over
  cleverness; avoid speculative features, premature optimization, and abstractions
  without a concrete need. Do not sacrifice clarity just to reduce line count.
- Name operational limits and include units: `requestTimeoutMs`, `maxResponseBytes`,
  `sourceLeaseSeconds`. Define shared policies once; keep local defaults with their owner.
- Document non-obvious limits and test relationships between deadlines, cleanup budgets,
  and leases. Do not create constants for ordinary indexes or counters.
- Prefer clear control flow, descriptive names, braces, and multiline error handling.
  Avoid nested ternaries, opaque boolean arguments, and unnecessary abstractions.
- Keep orchestration, parsing, HTTP, and persistence separate. Put tests in the owning
  package and use deliberate public interfaces across package boundaries.
- Keep database connection/deadline/shutdown handling in `packages/db/src/client.ts`
  and ingestion queries in `postgres-ingestion-store.ts`. Route queries through the bounded
  transaction helper and its named `query` executor so each statement has paired
  request/response logs. Add response fields deliberately through the logging
  sanitizer's allowlist, preserving redaction and size limits. Keep `index.ts`
  focused on public exports and wiring.
- Resolve invocation source keys through the database. Select publisher adapters
  using the stored name/category, and validate registrations with that adapter;
  adding a source row does not establish URL or metadata support for a new publisher.
- Require `sourceKey` in live ingestion events/commands and load feed URLs from
  Postgres, including live previews. Keep feed URL examples in seeds/tests/docs,
  not runtime constants; publisher URL allowlists remain adapter-owned validation.
- Keep publisher constants, URL policies, feed parsing and review extraction under
  `packages/rss/src/publishers/<publisher>/`. Keep `shared` publisher-neutral and
  metadata hashing with the database merge logic; name public publisher APIs explicitly.
- Keep streaming-provider matches separate from editorial track metadata and its
  hash. Provider recording IDs may be shared across review rows; matching does
  not establish listener playback eligibility. Writers must lock the editorial
  track before saving matches or changing its identity, reject stale artist/title
  lookup results, invalidate all provider rows on identity changes, and preserve
  matches on transient provider errors.
- Evaluate new publisher feeds as posts before assuming one track per item. Treat
  intentional non-track skips separately from extraction failures; writers, tags,
  tracklists and incidental song mentions do not establish credited recommendations.
- Preserve primary failures when cleanup fails. Bound cleanup, make cancellation
  ownership explicit, and never expose secrets in logs or errors.
- In `apps/web`, keep state and formatting logic in plain `.ts` modules tested from
  `apps/web/test`; components stay presentational. Put design values in per-theme
  custom properties in the feature's stylesheet rather than inline styles.
- Keep changes focused. Add regression tests for affected boundaries and failure paths;
  verify typechecking and relevant tests, plus the Lambda bundle when affected.
- Report skipped checks and blockers honestly; record significant changes in `TASKS.md`.
- Redaction tests must assert against their complete synthetic secret markers,
  not the word `private`, which also appears in macOS `/private/tmp` worktree paths.
- Never install dependencies, apply remote migrations, or deploy infrastructure without
  the required explicit authorization. Keep credentials and generated builds out of Git.
