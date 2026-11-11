# Repository Guidelines

These rules supplement inherited instructions, including the dependency-installation policy.

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
- Preserve primary failures when cleanup fails. Bound cleanup, make cancellation
  ownership explicit, and never expose secrets in logs or errors.
- Keep changes focused. Add regression tests for affected boundaries and failure paths;
  verify typechecking and relevant tests, plus the Lambda bundle when affected.
- Report skipped checks and blockers honestly; record significant changes in `TASKS.md`.
- Never install dependencies, apply remote migrations, or deploy infrastructure without
  the required explicit authorization. Keep credentials and generated builds out of Git.
