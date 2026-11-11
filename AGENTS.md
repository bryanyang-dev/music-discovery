# Repository Guidelines

These rules supplement inherited instructions, including the dependency-installation policy.

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
  environment variables. `pnpm upload:lambda` updates code and the CA certificate
  only; the retained CloudFormation template is undeployed, and CDK is not in use.
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
  transaction helper; keep `index.ts` focused on public exports and wiring.
- Use `.interface.ts` for files dedicated to behavioral contracts and name concrete
  implementations for their backing technology (for example, `postgres-ingestion-store.ts`).
  Keep data shapes in `models.ts`; internal modules import their owners directly,
  while package consumers use the public `index.ts` exports.
- Preserve primary failures when cleanup fails. Bound cleanup, make cancellation
  ownership explicit, and never expose secrets in logs or errors.
- Keep changes focused. Add regression tests for affected boundaries and failure paths;
  verify typechecking and relevant tests, plus the Lambda bundle when affected.
- Report skipped checks and blockers honestly; record significant changes in `TASKS.md`.
- Never install dependencies, apply remote migrations, or deploy infrastructure without
  the required explicit authorization. Keep credentials and generated builds out of Git.
