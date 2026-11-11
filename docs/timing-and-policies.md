# Timing and policy files

These files hold application limits at the layer that enforces them. They do not
configure AWS or Supabase. Keep Lambda timeout/concurrency settings in the console.

| File | Owns | Change it when… |
| --- | --- | --- |
| [`apps/ingestion/src/timing.ts`](../apps/ingestion/src/timing.ts) | Total work time and time reserved for cleanup | Changing how long a run may work before finalizing and closing |
| [`packages/db/src/policy.ts`](../packages/db/src/policy.ts) | Database connection, transaction and shutdown limits | Tuning database waits, socket lifetime or cleanup |
| [`packages/rss/src/http-policy.ts`](../packages/rss/src/http-policy.ts) | HTTP request, retry and response-safety limits | Tuning publisher requests or accepted response sizes |
| [`apps/ingestion/src/handler.ts`](../apps/ingestion/src/handler.ts) | RSS fetch phase and its retry loop | Changing feed retry behavior without changing review requests |

## Run budget: timing.ts

`maxWorkDurationMs` is 240,000 ms. The handler creates one shared cancellation
signal for HTTP/database work using:

```text
work time = min(240,000 ms, Lambda remaining time - cleanupReserveMs)
cleanupReserveMs = 15,000 + 3 × 3,000 + 250 = 24,250 ms
```

The reserve covers termination of an aborted operation (3 s), run finalization
(15 s plus up to 3 s for termination), connection close (3 s), and logging/return
(250 ms). It is derived from database policy so changing those limits also changes
the reserve. Finalization uses its own database deadline after the work signal ends.

With 300 s remaining, work gets 240 s, leaving 60 s. With 30 s remaining, it gets
5.75 s. If the reserve cannot fit, the handler fails before connecting. Direct
`ingestSource` calls without a supplied signal use a 240 s work deadline;
only the Lambda handler can account for remaining invocation time.

## Database limits: policy.ts

| Setting | Current value | Purpose |
| --- | --- | --- |
| `maxConnectionCount` | 1 | Maximum sockets per client/invocation; concurrent invocations each have their own client |
| `connectTimeoutSeconds` | 5 s | Bound opening a database connection |
| `idleTimeoutSeconds` | 20 s | Close unused sockets; subsequent operations may reconnect |
| `lockTimeoutMs` | 2,000 ms | Stop a SQL statement waiting too long for a database lock |
| `statementTimeoutMs` | 8,000 ms | Bound each SQL statement, including lock waits |
| `operationTimeoutMs` | 15,000 ms | Bound the whole database transaction from the client side |
| `closeTimeoutSeconds` | 3 s | Bound graceful close and the wait for forced termination |
| `forceCloseTimeoutSeconds` | 0 s | Tear down immediately on work cancellation/operation timeout |

The intended order is **lock (2 s) < statement (8 s) < operation (15 s)**; connection
setup (5 s) also fits inside the operation deadline. SQL timeouts are set inside
each transaction for compatibility with transaction pooling. The outer operation
deadline catches stalled client/connection/transaction work and terminates the
driver. The handler then awaits close in `finally`.

These settings do not cap Supabase's backend pool or guarantee cleanup after a
hard Lambda kill. There is no source lease or global connection lock.

## HTTP limits: http-policy.ts

`requestTimeoutMs` allows 12,000 ms per attempt, including up to three redirects
and reading the body. The HTTP helper defaults to three attempts with 250/500 ms
backoff (`initialRetryDelayMs` × `retryBackoffMultiplier`). It honors Retry-After;
if the required wait exceeds `maxRetryDelayMs` (10,000 ms), it stops retrying rather
than shortening the wait. Only transient failures qualify.

The handler disables that inner retry loop for RSS and instead allows an initial
attempt plus three retries with 1/2/4 s backoff, all inside a 30 s RSS cap and the
shared work deadline. Its Retry-After waits are not subject to the helper's 10 s
limit. Reviews retain the helper defaults. An individual request's 12 s timeout
never extends the shared deadline.

`maxFeedResponseBytes` (2,000,000) and `maxReviewResponseBytes` (3,000,000) bound
decompressed response bodies. `maxValidatorCharacters` (1,000) bounds HTTP cache
validator values. These are HTTP safety limits; feed-item/metadata limits stay in
their parsers. Ingestion sends stored validators and retains response validators
only after a successful run.

## Changing a limit

Change the file owning the behavior rather than duplicating its constants. Check
nested deadlines together: an allowed HTTP retry may still run out of overall
time, and a larger database cleanup budget leaves less Lambda work time. Raising
code limits does not raise the console's Lambda timeout. Keep a cleanup margin.

Relevant checks are `apps/ingestion/test/timing.test.ts`,
`apps/ingestion/test/handler.test.ts`, `packages/db/test/policy.test.ts`,
`packages/db/test/deadline.test.ts` and `packages/rss/test/policy.test.ts`.
The timing test compares against the **undeployed template's** 300 s timeout;
it does not verify the live console setting.
