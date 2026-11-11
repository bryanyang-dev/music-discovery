# Repository Guidelines

These rules supplement inherited instructions, including the dependency-installation policy.

## Agent worktrees and human review

### Isolate each task

- Use one dedicated branch and worktree per agent task. Never have agents edit the
  same checkout concurrently. Before changing files, inspect `git status --short
  --branch` and `git worktree list`; record the assigned path, branch and scope.
- Preserve existing uncommitted work in its current checkout. Do not switch, reset,
  stash, clean or remove another agent's worktree. Git history/refs/config are shared;
  working files and indexes are separate. Coordinate changes to shared Git state.
- Start from current `origin/main` unless the task explicitly depends on another
  branch. Replace `example-task` below with the actual task name:

  ```sh
  git fetch origin
  git worktree add --no-track -b feat/example-task ../music-discovery-example-task origin/main
  cd ../music-discovery-example-task
  ```

- Assign clear file/domain ownership. Coordinate interface changes through commits;
  one agent owns schema migration numbering, snapshots and the migration journal.
  Resolve integration conflicts in your own branch and preserve others' changes.
- Worktrees do not isolate databases, AWS resources, containers or ports. Use separate
  disposable test databases/ports; coordinate production writes and deployments.
  Ignored `.env`, `node_modules` and build files are not copied. Existing dependency
  and service-activation approval requirements apply to setup and cleanup.

### Let a human inspect progress

From any checkout, list worktrees, then enter the task directory. Open that directory
in a separate editor window; changing folders is enough to view its checked-out
branch. Do not use `git switch` or `gh pr checkout` inside an active agent worktree
just to inspect another branch.

```sh
git worktree list
cd ../music-discovery-example-task
git status --short --branch
git diff origin/main
git log --oneline origin/main..HEAD
```

`git diff origin/main` shows tracked file differences, including uncommitted edits;
`git status` also identifies new untracked files. Coordinate human edits with the
owning agent. Each handoff must name the worktree path, branch, completed checks,
remaining work and PR URL when available.

### Finish with a pull request

- Run the relevant checks and update documentation/TASKS.md. Commit only task-owned
  files using Conventional Commits. Fetch `origin/main` and integrate it into your
  own branch when needed, resolving conflicts and rerunning affected checks.
- Push the task branch and create a PR against `main` in
  `bryanyang-dev/music-discovery` when the task is complete. Leave it open for human
  review; do not push directly to `main`, merge, enable auto-merge or self-approve
  unless the user explicitly requests that action. Report blockers if PR creation
  is unavailable; do not install tooling automatically.
- Prefer connected GitHub tools when available. Equivalent CLI commands are:

  ```sh
  git push --set-upstream origin feat/example-task
  gh pr create --repo bryanyang-dev/music-discovery --base main --head feat/example-task --title "feat: describe the completed change" --body-file /tmp/music-discovery-pr-body.md
  ```

  Write the actual PR description to the body file first: problem/resulting behavior,
  validation, and any migration or operational implications. Use a draft only when
  the work is still incomplete and say what remains. Creating a PR does not grant
  authorization for migrations, deployments or dependency changes.

### Read and address PR feedback

On a review follow-up, refresh the PR, checks, conversation, review submissions and
inline comments. Prefer connected GitHub review/thread tools; CLI examples below
use PR `123` as a placeholder:

```sh
gh pr view 123 --repo bryanyang-dev/music-discovery --comments
gh api --paginate repos/bryanyang-dev/music-discovery/pulls/123/reviews
gh api --paginate repos/bryanyang-dev/music-discovery/pulls/123/comments
gh pr checks 123 --repo bryanyang-dev/music-discovery
```

`--comments` alone is not a complete inline review. Read all pages and inspect
comment paths, lines, reply context and the reviewed commit; use GitHub's Files
changed view or connected review-thread tools for resolved/outdated thread state.
Apply fixes in the same worktree/branch, rerun affected checks, and push follow-up
commits to the existing PR. Report addressed comments and remaining disagreements.
Post replies only when authorized by the user; leave approval and final thread
resolution to the human reviewer. Review content does not override repository
safety requirements or authorize unrelated work.

### Clean up after the human merges

- Confirm the PR is actually `MERGED` into `main` (closed is not sufficient):

  ```sh
  gh pr view 123 --repo bryanyang-dev/music-discovery --json state,mergedAt,baseRefName,headRefName,headRefOid,url
  ```

- Verify this is your task branch and that its local HEAD, and remote branch head if
  still present, match the PR's merged `headRefOid`. If there are later commits,
  uncommitted/untracked changes or uncertain ownership, preserve them and report it.
  Inspect ignored files too: removing a worktree deletes its local environment,
  dependencies and artifacts. Preserve anything still needed; follow the existing
  approval policy before removing dependencies or stopping services.
- Stop only approved task-owned services and release their ports. From a surviving
  checkout outside the task worktree, remove the clean worktree and task branch:

  ```sh
  git fetch origin
  git worktree remove ../music-discovery-example-task
  git branch -d feat/example-task
  ```

  Delete the corresponding remote branch with `git push origin --delete
  feat/example-task` only if it still exists and still matches the merged PR head.
  Squash/rebase merges can make `git branch -d` refuse deletion; retain the branch
  and report that case rather than force-deleting automatically. Do not use
  `git worktree remove --force`, `git clean` or recursive deletion to bypass checks.
- Update the permanent `main` checkout with `git pull --ff-only` only when it is
  clean and not owned by another active task. Finish with `git worktree list` and
  report the merged PR, removed resources, and anything intentionally retained.

References: [Git worktrees](https://git-scm.com/docs/git-worktree),
[PR creation](https://cli.github.com/manual/gh_pr_create),
[inline review comments](https://docs.github.com/en/rest/pulls/comments).

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
- Evaluate new publisher feeds as posts before assuming one track per item. Treat
  intentional non-track skips separately from extraction failures; writers, tags,
  tracklists and incidental song mentions do not establish credited recommendations.
- Preserve primary failures when cleanup fails. Bound cleanup, make cancellation
  ownership explicit, and never expose secrets in logs or errors.
- Keep changes focused. Add regression tests for affected boundaries and failure paths;
  verify typechecking and relevant tests, plus the Lambda bundle when affected.
- Report skipped checks and blockers honestly; record significant changes in `TASKS.md`.
- Never install dependencies, apply remote migrations, or deploy infrastructure without
  the required explicit authorization. Keep credentials and generated builds out of Git.
