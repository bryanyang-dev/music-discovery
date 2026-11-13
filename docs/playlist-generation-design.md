# Per-user playlist generation design

**Status:** Proposed. Nothing in this document is implemented yet. Current behavior
is described in the [ingestion specification](ingestion-spec.md) and
[operations guide](operations.md) until the migration below completes.
Implementation is tracked in
[issue #44](https://github.com/bryanyang-dev/music-discovery/issues/44).

## Summary

Tape Journal is moving to per-user mixtapes built from songs that an LLM extracts
from music publications' RSS feeds.

- **Discovery (shared, background):** a scheduled serverless pipeline fetches every
  registered feed, sends new or changed posts to Claude for structured extraction
  of recommended songs and artists, validates the results against the post text
  and matches them on Spotify. Any RSS or Atom feed can be registered; no
  per-publisher parser is needed.
- **Tapes (per user):** a user who has connected Spotify asks for a tape. An
  asynchronous job picks 10 recent, matched tracks they have not had before, and
  the UI loads the new cassette when it is ready. Tapes play through the Spotify
  Web Playback SDK and can be saved to the user's Spotify account.

### Goals

- Register any music publication's RSS/Atom feed without writing a parser.
- Credit every track to a real post, with evidence quoted from that post.
- Any user who has connected Spotify can generate tapes.
- Generation is asynchronous; the UI shows progress and the finished tape.
- Tapes play inside the cassette UI with its own controls.
- Users can save a tape to Spotify as a private playlist.
- Tapes stay varied: a user never gets the same song twice, and artists,
  publications and genres rotate across tapes.
- Tracks carry genre and descriptor metadata so that
  [prompt-based tapes](#future-prompt-based-tapes) can filter by genre and
  publication later without reprocessing.
- LLM cost scales with the number of feed posts, not users, and is capped.

### Non-goals (first release)

- User-submitted feeds (operators register feeds; see [open questions](#open-questions)).
- Free-text prompts and saved preferences. The metadata they need is captured
  from the start; the feature is a [later phase](#future-prompt-based-tapes).
- Mobile-browser playback (the SDK does not support it).
- Sharing tapes between users or social features.
- Real-time push notifications (polling is sufficient).
- Migrating existing Pitchfork `tracks` rows; the Pitchfork feed is re-ingested
  through the new pipeline instead.

## User experience

1. **Connect.** The user selects "Connect Spotify" and signs in through Supabase
   Auth's Spotify provider. The app records their Spotify profile, country and
   subscription level.
2. **Generate.** The user selects "Make a tape". The UI shows a tape being
   recorded while it polls the job status. Only one tape per user can be in
   progress, and a daily limit applies.
3. **Receive.** When the job succeeds, the new tape appears in the tape box (or is
   loaded into the player). Each track shows its publication and the quoted
   evidence, linking to the source post.
4. **Play.** Loading a tape plays its tracks through the Web Playback SDK. The
   cassette's play/pause, next and previous controls drive the SDK, and SDK state
   drives the cassette.
5. **Save.** "Save to Spotify" creates (or updates) a private playlist in the
   user's account and links to it.

Spotify Free users can generate and save tapes but see a "Premium required to play
here" state with an "Open in Spotify" link once saved. Unsupported browsers see a
similar message.

## Architecture

```
Discovery (scheduled, shared)

EventBridge Scheduler (hourly)
  └▶ Feed fetch Lambda ── conditional GET per enabled source ── generic RSS/Atom parse
        └─ upsert feed_items; new/changed content ──▶ SQS extract-items (+ DLQ)
                                                       └▶ Extractor Lambda ── Claude structured output
                                                             └─ validated tracks ──▶ SQS match-tracks (+ DLQ)
                                                                                       └▶ Track matcher Lambda ── Spotify search

Tapes (per user)

Browser (apps/web, S3 + CloudFront)
  │  Supabase Auth (Spotify provider, PKCE) ──▶ Supabase session JWT
  ├─ POST /mixtapes ──────────▶ API Lambda ──insert mixtape (queued)──▶ Postgres
  │                                  └── async invoke ──▶ Tape generator Lambda
  │                                                         select tracks → check market playability → store tape
  ├─ GET /mixtapes/:id (poll) ▶ API Lambda
  ├─ GET /me/spotify-token ───▶ API Lambda ──refresh──▶ Spotify Accounts
  ├─ POST /mixtapes/:id/spotify-playlist ──▶ API Lambda ──▶ Spotify Web API
  └─ Web Playback SDK ◀──▶ Spotify
```

All Regional AWS resources live in the project Region, `us-east-2`. CloudFront is
global by design. API Gateway, Lambda, SQS, EventBridge Scheduler, KMS and S3 stay
in `us-east-2`.

### Why this shape

- **SQS between stages** gives per-item retries, a dead-letter queue for poison
  items and partial batch failure reporting. The event source mapping's maximum
  concurrency is the throttle for model rate limits and spend. Step Functions is
  not needed for a linear pipeline.
- **Deterministic fetching before the LLM.** Conditional GETs, item deduplication
  and content hashes mean only new or changed posts reach Claude.
- **One structured-output call per post.** Extraction is a bounded transformation,
  not an agent: no tools, no loop, schema-constrained output.
- **Tape generation needs no LLM.** It selects from already matched tracks, so a
  tape costs only database reads and a few Spotify calls.

### Components

| Component      | Location                                | Responsibility                                                                   |
| -------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| Web app        | `apps/web`                              | Auth, tape box from the API, generation/polling UI, SDK player, save action      |
| API            | `apps/api` (new)                        | JWT verification, limits, tape jobs and reads, Spotify token issuance, saving    |
| Feed fetcher   | `apps/ingestion` (reworked)             | Scheduled fetch of all enabled sources, item upsert, extraction enqueue          |
| Extractor      | `apps/extractor` (new)                  | SQS consumer: post text, Claude call, validation, track upsert, match enqueue    |
| Track matcher  | `apps/track-matcher` (reworked)         | SQS consumer for extracted tracks; existing Spotify matching rules               |
| Tape generator | `apps/tape-generator` (new)             | Job claim, track selection, market playability check, tape persistence           |
| Feeds          | `packages/rss` (reworked)               | HTTP policy, URL safety, generic RSS/Atom parsing, HTML-to-text                  |
| Extraction     | `packages/extraction` (new)             | Prompt, output schema, Claude client, evidence validation                        |
| Spotify client | `packages/spotify` (new)                | Moved from the matcher; adds token refresh, profile, playback and playlist calls |
| Database       | `packages/db`                           | Schema, migrations, stores behind the bounded transaction helper                 |
| Shared         | `packages/shared`                       | Data shapes, store interfaces, error codes                                       |
| Retired        | `packages/rss/src/publishers/pitchfork` | Replaced by generic parsing and extraction                                       |

The existing conventions still apply: paired request/response logs for every
external call, sanitized log allowlists, named limits with units, bounded cleanup
and no secrets in logs or errors.

## Discovery pipeline

### Sources

Operators register feeds with a reworked `pnpm sources:add --key --name --feed-url`.
Registration no longer selects a publisher adapter. It fetches the URL through the
same safety policy, parses it as RSS or Atom and reports the item count before
inserting. A preview command (`pnpm ingest:preview --source <key>`) fetches and
extracts without writing, so a new feed can be checked before it is enabled.

### Fetching

One EventBridge Scheduler schedule invokes the feed fetch Lambda hourly with no
payload. The Lambda loads all enabled sources and processes them with bounded
parallelism (`feedFetchConcurrency`), each under its own deadline
(`feedFetchTimeoutMs`). A failure in one source is recorded in its
`ingestion_runs` row and does not affect the others. If the source count outgrows
one invocation, the fetcher can fan out one SQS message per source later.

For each source:

1. Conditional GET using stored `ETag`/`Last-Modified`; `304` ends the run.
2. Parse RSS 2.0, RSS 1.0 or Atom, at most `maxItemsPerFeed` items. Item key is the
   GUID when present and stable, otherwise the normalized link.
3. Post text is `content:encoded`, then `description`/`summary`, converted from HTML
   to text with link text kept. If it is shorter than `minItemTextChars`, the
   linked article is fetched (same URL safety and size limits) and its main text
   is used. The item's `<category>` values are kept as `categories`.
4. A `content_hash` of the normalized text decides whether the item is new,
   changed or unchanged. New and changed items are committed as `pending` and
   their IDs are sent to `extract-items` after commit. Unchanged items are skipped.
5. Text longer than `maxExtractionInputChars` is not truncated; the item is marked
   `skipped_too_large` and reported.

### URL safety

Feed URLs and article links are untrusted. Every request, including each redirect
hop:

- must be HTTPS without credentials;
- must resolve only to public addresses (loopback, private, link-local, multicast
  and the Lambda runtime API at `127.0.0.1:9001` are rejected), with the resolved
  address pinned for the connection;
- is bounded by the existing response-size and deadline limits.

### Extraction

The extractor Lambda consumes `extract-items` with batch size 1, maximum
concurrency `extractionMaxConcurrency` and partial batch failure reporting. Queue
visibility timeout is at least six times the function timeout; messages go to the
DLQ after `extractionMaxReceives` attempts.

1. Load the item; skip if its current `content_hash` has already been extracted
   (makes duplicate delivery harmless).
2. Call Claude with `output_config.format` set to the extraction JSON schema.
   Model `claude-opus-5-5`, `effort: "low"`, no tools. The system prompt holds the
   rules and the genre vocabulary; the post's publication, title, URL, date,
   categories and text go in the user message inside clearly delimited tags and
   are described as untrusted content.
3. Handle `refusal` and `max_tokens` stop reasons as item failures with safe codes.
4. Validate, then in one transaction replace the item's extracted tracks and mark
   the item `extracted` (or `no_tracks`). Tracks whose identity is unchanged keep
   their IDs and Spotify matches.
5. After commit, send new `recommended` track IDs to `match-tracks`.

Output schema:

```json
{
  "isMusicPost": true,
  "tracks": [
    {
      "title": "Song title",
      "artists": ["Artist"],
      "kind": "recommended",
      "evidence": "Exact sentence from the post that credits this song.",
      "genres": [
        { "name": "electronic", "basis": "stated" },
        { "name": "pop", "basis": "inferred" }
      ],
      "descriptors": ["hazy", "club-ready"]
    }
  ]
}
```

`kind` is `recommended` (the post recommends, reviews or premieres the song),
`mentioned` (incidental reference) or `tracklist` (listed without recommendation).
Only `recommended` tracks are matched and used in tapes. This preserves the
existing rule that writers, tags, tracklists and incidental mentions do not
establish credited recommendations.

**Album reviews** are a major source. A song the review singles out positively
(a standout, highlight or best track) is `recommended`, with the praising sentence
as evidence. Songs that a review only names neutrally or criticizes are
`mentioned`, and a full track listing is `tracklist`. A review that names no song
yields no tracks; the app never picks a song from a reviewed album on its own.

### Validation

A returned track is rejected, and recorded in the item's `issues`, unless:

- `evidence` appears in the post text after whitespace and case normalization;
- the title and every artist appear in the post text after the same normalization;
- title, artists and evidence are within length limits, and the item has no more
  than `maxTracksPerItem` tracks.

Duplicate tracks within an item are folded using the matcher's artist and title
normalization.

Metadata is validated without rejecting the track:

- Genre names outside the current vocabulary are dropped and recorded in `issues`.
- A genre marked `stated` is kept as stated only if its name or one of its listed
  aliases appears in the post text; otherwise it is demoted to `inferred`.
- At most `maxGenresPerTrack` genres and `maxDescriptorsPerTrack` descriptors are
  kept, each within length limits. Descriptors are lowercased and trimmed.

### Track metadata

Metadata is captured in the existing extraction call, so it adds output tokens but
no extra requests.

| Data                | Source                                      | Use                                 |
| ------------------- | ------------------------------------------- | ----------------------------------- |
| Publication         | `source_id`                                 | Filtering, diversity                |
| Publication profile | Operator-set `description` and `tags`       | Matching publication-style prompts  |
| Post categories     | Feed `<category>` elements                  | Extraction context, later filtering |
| Genres              | Extraction, from a fixed vocabulary         | Filtering, diversity                |
| Genre basis         | `stated` in the post or `inferred` by model | Stated genres weigh more in ranking |
| Descriptors         | Extraction, up to 5 short free-text tags    | Ranking for mood and style prompts  |

**Genre vocabulary.** About 30–50 top-level genres, each with aliases (for example
`hip-hop`: "hip hop", "rap"), live in a versioned constant in
`packages/extraction`. Filtering uses only vocabulary genres; free-text variants
such as "indie-rock" and "indie rock" never reach the database as genres.
Descriptors keep the nuance the vocabulary loses.

**Inferred genres** come from the model's knowledge of the artist rather than the
post. They are useful but can be wrong, so they are stored separately and weigh
less than stated genres.

**Re-classification.** Each track records `taxonomy_version`. When the vocabulary
or prompt changes, an operator command re-runs extraction from the stored post
text for affected items, so posts that have dropped out of their feeds can still
be re-classified. Track identities are preserved, so Spotify matches and tape
history are unaffected.

Spotify is not a metadata source: audio features are not available to new apps,
and artist genres are coarse and may be restricted. MusicBrainz or Last.fm tags are
possible later enrichments, not first-release dependencies.

### Matching

The existing track matcher keeps its search and normalization rules (bonus-track
labels, complete artist sets, ambiguity across distinct recording IDs). It gains an
SQS handler for `match-tracks`, reads the new `extracted_tracks` table and also
stores the recording's ISRC when Spotify provides it. It uses
the default `SPOTIFY_MARKET`; per-user availability is checked when a tape is
built. Provider failures leave the track unmatched for a later retry.

### Model access

Extraction needs no web search, so Amazon Bedrock is an option alongside Claude
Platform on AWS and the Anthropic API. Bedrock and Claude Platform on AWS use IAM
instead of a stored API key. Confirm that the chosen model is available in
`us-east-2` without cross-Region inference before choosing Bedrock (see
[open questions](#open-questions)).

The Message Batches API halves model cost at the price of up to 24 hours of
latency and a polling step. It is a later optimization once per-item cost is
measured.

## Authentication and Spotify tokens

### Sign-in

The web app calls Supabase `signInWithOAuth({ provider: "spotify" })` with the
PKCE flow and these scopes:

| Scope                        | Used for                                 |
| ---------------------------- | ---------------------------------------- |
| `user-read-private`          | Country (market) and product level       |
| `user-read-email`            | Required by Supabase's Spotify provider  |
| `streaming`                  | Web Playback SDK                         |
| `user-modify-playback-state` | Starting tape playback on the SDK device |
| `user-read-playback-state`   | Recovering player state                  |
| `playlist-modify-private`    | Save to Spotify                          |

Requesting every scope at sign-in avoids a second consent prompt later. Supabase's
Spotify provider uses the same Spotify app (client ID and secret) that the backend
uses for token refresh and catalog search.

Supabase returns the Spotify `provider_token` and `provider_refresh_token` to the
browser only at sign-in and does not refresh them. Immediately after sign-in, the
web app sends the refresh token once to `POST /me/spotify-credentials`. The API:

1. Verifies the Supabase JWT.
2. Refreshes the token with Spotify and calls `GET /v1/me`.
3. Rejects the request unless the Spotify user ID equals the Spotify identity
   linked to that Supabase user.
4. Upserts `app_users`, and stores the refresh token encrypted with KMS.

The browser discards the refresh token after this call.

### Access tokens

`GET /me/spotify-token` returns a short-lived access token and its expiry for the
SDK's `getOAuthToken` callback and the browser's playback-start call. The API
refreshes when the cached token is within `spotifyTokenRefreshMarginSeconds` of
expiry. Refresh runs under a row lock on `spotify_credentials`, because Spotify may
rotate the refresh token; a returned replacement is stored in the same
transaction. A Spotify `invalid_grant` response marks the credential revoked, and
the API returns `SPOTIFY_RECONNECT_REQUIRED` so the UI prompts the user to sign in
again.

### API authentication

API Lambdas verify the Supabase JWT on every request: signature against the
project's JWKS (asymmetric signing keys), issuer, `aud = authenticated` and
expiry. The user ID is the token's `sub`. The frontend does not query Postgres
directly; it uses Supabase only for auth.

## Data model

New tables are added in migrations. RLS is enabled with no anonymous or
`authenticated` policies, because only backend roles read and write them. Every
user-facing query filters by the verified user ID.

### Discovery tables

**`ingestion_sources`** (existing, simplified): `key`, display `name`, `feed_url`,
`enabled`, `etag`, `last_modified`, `last_attempt_at`, `last_success_at`, plus new
optional `description` and `tags text[]` for the publication profile. The
`category` column and adapter selection by `name` are removed.

**`ingestion_runs`** (existing): one row per source fetch. Counts become
`found`, `inserted`, `changed`, `unchanged`, `rejected` and `enqueued` items.

**`feed_items`**

| Column              | Type        | Notes                                                                 |
| ------------------- | ----------- | --------------------------------------------------------------------- |
| `id`                | uuid PK     |                                                                       |
| `source_id`         | uuid FK     | `ingestion_sources.id`                                                |
| `item_key`          | text        | GUID or normalized link; unique with `source_id`                      |
| `url`               | text        | Post URL                                                              |
| `title`             | text        |                                                                       |
| `published_at`      | timestamptz | Nullable                                                              |
| `categories`        | text[]      | Feed `<category>` values                                              |
| `post_text`         | text        | Normalized text sent to extraction, at most `maxExtractionInputChars` |
| `content_hash`      | text        | Hash of normalized text                                               |
| `extracted_hash`    | text        | Hash last extracted; equal to `content_hash` when up to date          |
| `extraction_status` | text        | `pending`, `extracted`, `no_tracks`, `failed`, `skipped_too_large`    |
| `error_code`        | text        | Safe code                                                             |
| `issues`            | jsonb       | Rejected tracks and reasons (bounded)                                 |
| `model`             | text        | Claude model ID                                                       |
| `usage`             | jsonb       | Input/output tokens, estimated cost                                   |
| `first_seen_at`     | timestamptz |                                                                       |
| `extracted_at`      | timestamptz |                                                                       |

Post text is stored so that items can be re-extracted after vocabulary or prompt
changes without re-fetching. It is public content, but it is still excluded from
logs.

**`extracted_tracks`**

| Column             | Type        | Notes                                              |
| ------------------ | ----------- | -------------------------------------------------- |
| `id`               | uuid PK     |                                                    |
| `item_id`          | uuid FK     | `feed_items.id`                                    |
| `title`            | text        | Editorial title                                    |
| `artists`          | text[]      | Editorial artists                                  |
| `kind`             | text        | `recommended`, `mentioned`, `tracklist`            |
| `evidence`         | text        | Verified quote from the post                       |
| `identity`         | text        | Normalized artist/title key; unique with `item_id` |
| `stated_genres`    | text[]      | Vocabulary genres stated in the post               |
| `inferred_genres`  | text[]      | Vocabulary genres inferred by the model            |
| `descriptors`      | text[]      | Free-text style and mood tags                      |
| `taxonomy_version` | integer     | Vocabulary and prompt version used                 |
| `created_at`       | timestamptz |                                                    |

GIN indexes on `stated_genres`, `inferred_genres` and `descriptors` support
filtering. A check constraint keeps the two genre arrays disjoint.

**`extracted_track_matches`** keeps the columns and state constraints of today's
`track_streaming_matches` (provider, status, recording ID, URL, provider
metadata, method, attempt diagnostics), keyed by `(track_id, provider)` and
referencing `extracted_tracks`, and adds a nullable `isrc`. Editorial metadata
stays separate from provider metadata, as today.

### User tables

**`app_users`**

| Column            | Type        | Notes                                     |
| ----------------- | ----------- | ----------------------------------------- |
| `id`              | uuid PK     | `auth.users.id`, `ON DELETE CASCADE`      |
| `spotify_user_id` | text unique |                                           |
| `display_name`    | text        | Nullable                                  |
| `country`         | char(2)     | Market for playability checks             |
| `spotify_product` | text        | `premium`, `free`, … (refreshed on login) |
| `created_at`      | timestamptz |                                           |
| `updated_at`      | timestamptz |                                           |

**`spotify_credentials`**

| Column                    | Type        | Notes                                           |
| ------------------------- | ----------- | ----------------------------------------------- |
| `user_id`                 | uuid PK FK  | `app_users.id`, cascade                         |
| `refresh_token_encrypted` | bytea       | KMS ciphertext, encryption context `{ userId }` |
| `access_token_encrypted`  | bytea       | Cached access token, nullable                   |
| `access_token_expires_at` | timestamptz | Nullable                                        |
| `scopes`                  | text[]      | Granted scopes                                  |
| `revoked_at`              | timestamptz | Set on `invalid_grant`; cleared on reconnect    |
| `updated_at`              | timestamptz |                                                 |

**`mixtapes`** — a row is both the generation job and its result. The tape box
shows only `succeeded` rows.

| Column                | Type        | Notes                                        |
| --------------------- | ----------- | -------------------------------------------- |
| `id`                  | uuid PK     | Tape identity in the UI                      |
| `user_id`             | uuid FK     |                                              |
| `status`              | text        | `queued`, `running`, `succeeded`, `failed`   |
| `title`               | text        | For example the creation date                |
| `requested_at`        | timestamptz |                                              |
| `started_at`          | timestamptz |                                              |
| `finished_at`         | timestamptz |                                              |
| `lease_expires_at`    | timestamptz | Running jobs past this are treated as failed |
| `error_code`          | text        | Safe code only                               |
| `market`              | char(2)     | Market used for the playability check        |
| `selection_stats`     | jsonb       | Pool size, diversity measures, relaxations   |
| `spotify_playlist_id` | text        | Set by save; nullable                        |
| `spotify_saved_at`    | timestamptz | Nullable                                     |

Indexes and constraints:

- Partial unique index on `(user_id)` where `status IN ('queued', 'running')`
  enforces one active generation per user.
- Index on `(user_id, requested_at DESC)` for the tape box and daily-limit count.
- Check constraints for valid status values and for `succeeded` rows having
  `finished_at` set.

**`mixtape_tracks`** stores a snapshot so a tape never changes after creation.

| Column               | Type     | Notes                                |
| -------------------- | -------- | ------------------------------------ |
| `mixtape_id`         | uuid FK  | Cascade; PK with `position`          |
| `position`           | smallint | 1–10                                 |
| `extracted_track_id` | uuid FK  | Nullable if the source track is gone |
| `title`, `artists`   |          | Editorial metadata                   |
| `song_identity`      | text     | Normalized artist/title key          |
| `genres`             | text[]   | Stated and inferred genres at pick   |
| `source_id`          | uuid FK  | Publication, for rotation            |
| `publication`        | text     | Source display name                  |
| `source_url`         | text     | Post URL                             |
| `evidence`           | text     | Quote shown on the J-card            |
| `spotify_track_id`   | text     |                                      |
| `isrc`               | text     | Nullable                             |
| `spotify_title`      | text     | Provider metadata, kept separately   |
| `spotify_artists`    | text[]   |                                      |
| `album_image_url`    | text     | For the J-card                       |
| `duration_ms`        | integer  |                                      |

Unique `(mixtape_id, spotify_track_id)` prevents duplicate recordings on a tape.
Indexes on `spotify_track_id`, `isrc` and `song_identity` (joined through
`mixtapes.user_id`) support the per-user history checks in
[track selection](#track-selection-and-diversity).

### Retired tables

`tracks` and `track_streaming_matches` are dropped in the cleanup phase by an
authorized migration, after the new pipeline has re-ingested the registered feeds.

## API

All routes require a Supabase JWT, return JSON and use safe error codes
(`{ "code": "..." }`). CORS allows only the app origin and the local development
origin.

| Method | Path                             | Result                                                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------- |
| POST   | `/me/spotify-credentials`        | 204. Body `{ refreshToken }`. Links Spotify, stores the encrypted token, refreshes profile. |
| GET    | `/me`                            | Profile, `canPlay` (Premium), Spotify connection status, generations remaining today.       |
| GET    | `/me/spotify-token`              | `{ accessToken, expiresAt }`. 409 `SPOTIFY_RECONNECT_REQUIRED` when revoked.                |
| DELETE | `/me`                            | Deletes the user's data and Supabase auth user. 204.                                        |
| POST   | `/mixtapes`                      | 202 `{ id, status }`. 409 `GENERATION_IN_PROGRESS`; 429 `DAILY_LIMIT_REACHED`.              |
| GET    | `/mixtapes`                      | The user's succeeded tapes, newest first, cursor-paginated, with tracks.                    |
| GET    | `/mixtapes/:id`                  | Status, error code and (on success) tracks. 404 for another user's tape.                    |
| POST   | `/mixtapes/:id/spotify-playlist` | 200 `{ playlistId, url }`. Creates on first call; replaces items on later calls.            |

One API Lambda behind an API Gateway HTTP API serves every route. API Gateway
stage throttling provides a coarse request-rate limit.

## Tape generation

### Job lifecycle

1. `POST /mixtapes` checks the daily limit, inserts a `queued` row (the partial
   unique index rejects a second active job), then invokes the tape generator
   asynchronously with `{ mixtapeId }`. If the invoke call fails, the API marks the
   row `failed` with `GENERATOR_UNAVAILABLE`.
2. The generator claims the job with a conditional update from `queued` to
   `running`, setting `started_at` and `lease_expires_at`. A failed claim ends the
   invocation without work, so duplicate deliveries are harmless.
3. The generator writes all tracks and sets `succeeded` in one transaction, or sets
   `failed` with a safe code.
4. Reads treat a `running` row past `lease_expires_at` as failed and persist that
   transition (`GENERATION_TIMED_OUT`), freeing the user's active slot.

Asynchronous retry attempts are set to 0; the user can request another tape.

### Track selection and diversity

Selection lives in one pure, deterministic function
(`apps/tape-generator/src/tape-selection.ts`) with its tunables in
`tape-selection-policy.ts`, so it is fully testable offline. Diversity works at
two levels: hard rules that are never broken, and a score that rotates artists,
publications and genres across tapes.

**Candidate pool.** Tracks that are `recommended`, have a `matched` Spotify
recording, come from an enabled source and were published (or first seen) within
`tapeLookbackDays`. Recordings credited by several posts are considered once,
crediting the most recent post.

**Hard rules.**

1. **No repeated songs for a user, ever.** A candidate is excluded if its Spotify
   track ID, ISRC or `song_identity` appears on any of the user's earlier tapes.
   ISRC and identity catch the same song released under several Spotify IDs
   (single and album versions, re-releases). Remixes and live versions remain
   distinct songs under the matcher's normalization rules; the artist cooldown
   below keeps them from following each other closely.
2. **One track per artist per tape.** A candidate sharing any artist with a track
   already on the tape is skipped.
3. **Publication cap:** at most `maxTracksPerSourcePerTape` per publication.
4. **Genre cap:** at most `maxTracksPerGenrePerTape` per genre (stated or
   inferred), so one genre cannot dominate a tape.
5. **Playable in the user's market.**

**Scoring.** The generator fills the tape greedily: it scores every remaining
candidate, takes the highest, updates the tape's counts and repeats.

```
score = freshness
      − artistCooldownPenalty    if an artist appeared in the user's last artistCooldownTapes tapes
      − publicationSharePenalty  × that publication's share of the user's last historyWindowTapes tapes
      − genreSharePenalty        × that genre's share of the user's last historyWindowTapes tapes
      + jitter
```

- `freshness` decays with post age (half-life `freshnessHalfLifeDays`), so new
  recommendations lead without the newest posts filling every tape.
- The share penalties rotate across tapes: if the last few tapes leaned on one
  publication or genre, the next one leans elsewhere.
- `jitter` is a small random term seeded by the mixtape ID. Two users, or two tapes
  made from the same pool, differ, while any single selection stays reproducible
  in tests.

**Playability.** Picks are checked in the user's market in one Spotify catalog
request; unplayable recordings are dropped and the greedy fill continues. The exact
catalog endpoint and its availability for this app must be confirmed during
implementation; the fallback is a market-specific search per track.

**Relaxation.** If the tape cannot be filled, the generator relaxes in order and
records each step in `selection_stats`:

1. Extend the lookback to `tapeMaxLookbackDays`.
2. Lift the genre cap.

Hard rules 1, 2, 3 and 5 are never relaxed. If the tape is still short, the job
fails with `NOT_ENOUGH_TRACKS` (see [open questions](#open-questions)).

**Measurement.** `selection_stats` records the pool size, relaxations applied,
distinct artists, publications and genres on the tape, and the share of its
artists and publications that also appeared on the user's previous tape. The
generator logs these values, so the penalty weights can be tuned from real tapes,
and a shrinking per-user pool is visible before users hit `NOT_ENOUGH_TRACKS`.

## Playback

The web app loads `https://sdk.scdn.co/spotify-player.js` and creates one
`Spotify.Player` named "Tape Journal". Its `getOAuthToken` callback calls
`GET /me/spotify-token`.

- On `ready`, the app stores the `device_id`.
- Loading a tape calls Spotify `PUT /v1/me/player/play?device_id=…` from the
  browser with the tape's track URIs in order. No Spotify playlist is needed.
- Cassette controls call `togglePlay`, `nextTrack` and `previousTrack`.
  `activateElement()` runs on the first user gesture to satisfy autoplay rules.
- `player_state_changed` dispatches a reducer action. The reducer derives
  `trackIndex` from the current track URI and `playing` from `paused`, so the
  cassette follows the SDK. A state whose track is not on the loaded tape (for
  example, the user changed tracks in another Spotify app) shows the tape as
  stopped.
- `not_ready` and `player_state_changed` with no state (playback moved to another
  device) show the tape as paused, with an option to resume here.
- `account_error` (not Premium), `initialization_error` (unsupported browser) and
  `authentication_error` (prompt to reconnect) map to explicit UI states.

The `mixtape-session.ts` reducer changes tape identity from `date` to `id` and
gains SDK-driven actions. The SDK wrapper stays in a plain `.ts` module tested with
a fake player; components remain presentational.

## Save to Spotify

`POST /mixtapes/:id/spotify-playlist` locks the mixtape row, then:

- If `spotify_playlist_id` is empty, creates a private playlist in the user's
  account ("Tape Journal · <title>", with a description crediting the
  publications), adds the 10 tracks in order and stores the ID.
- Otherwise replaces the playlist's items so repeated saves never duplicate the
  playlist. If Spotify reports the playlist is gone, a new one is created.

Spotify's current-user playlist creation and item endpoints must be confirmed
against the live Web API reference during implementation.

## Limits and timing

| Name                               | Proposed value | Enforcement / notes                                        |
| ---------------------------------- | -------------- | ---------------------------------------------------------- |
| `feedFetchConcurrency`             | 5              | Sources fetched in parallel per run                        |
| `feedFetchTimeoutMs`               | 30,000         | Per source, including article fetches                      |
| `maxItemsPerFeed`                  | 100            | Items parsed per fetch                                     |
| `minItemTextChars`                 | 500            | Below this, fetch the linked article                       |
| `maxExtractionInputChars`          | 60,000         | Above this, `skipped_too_large`                            |
| `maxTracksPerItem`                 | 50             | Validation limit                                           |
| `extractionMaxConcurrency`         | 5              | SQS event source maximum concurrency                       |
| `extractionMaxReceives`            | 3              | Before the DLQ                                             |
| `dailyExtractionLimit`             | 500            | Items per UTC day; excess stays `pending` for the next day |
| `maxGenresPerTrack`                | 3              | Metadata validation                                        |
| `maxDescriptorsPerTrack`           | 5              | Metadata validation                                        |
| `tapeTrackCount`                   | 10             |                                                            |
| `tapeLookbackDays`                 | 30             | Initial candidate window                                   |
| `tapeMaxLookbackDays`              | 90             | Relaxed candidate window                                   |
| `maxTracksPerSourcePerTape`        | 3              | Publication cap (never relaxed)                            |
| `maxTracksPerGenrePerTape`         | 4              | Genre cap (relaxed last)                                   |
| `artistCooldownTapes`              | 3              | Recent tapes checked for repeated artists                  |
| `historyWindowTapes`               | 5              | Recent tapes used for publication and genre shares         |
| `freshnessHalfLifeDays`            | 14             | Freshness decay                                            |
| Active generations per user        | 1              | Partial unique index                                       |
| `dailyGenerationsPerUser`          | 5              | Protects Spotify quota and the track pool                  |
| `generationLeaseSeconds`           | 120            | Longer than the tape generator's 60-second timeout         |
| `spotifyTokenRefreshMarginSeconds` | 120            |                                                            |

Tests must assert deadline/lease relationships: the generator's work deadline
plus cleanup reserve fits its timeout, the lease exceeds the timeout, and the
extraction queue's visibility timeout is at least six times the extractor timeout.

`usage` on each feed item records tokens and estimated cost, so per-item cost can
be measured before limits are tuned. Scoring weights (the penalties and jitter
scale) are tuned from `selection_stats` and are not fixed by this design.

## Future: prompt-based tapes

Not part of the first release. The metadata above is captured from the start so
this phase needs no reprocessing.

```
"moody electronic from Pitchfork or The Quietus"
  └▶ Claude (structured output) → filter, validated against the vocabulary and sources:
       { genres: ["electronic"], descriptors: ["moody"], sources: ["pitchfork", "the_quietus"] }
  └▶ narrows the candidate pool → existing scoring and hard rules → tape
```

- `POST /mixtapes` accepts an optional `prompt`. The generator makes one small
  structured-output call that returns only a filter object. Unknown genres and
  sources are dropped, and an empty filter fails with `PROMPT_NOT_UNDERSTOOD`.
  The prompt never reaches extraction or the track data, which limits prompt
  injection to choosing a filter.
- Requested genres and sources narrow the pool before scoring. The genre cap does
  not apply to requested genres; artist, song-history and publication rules still
  do (the publication cap is waived when the user names a single publication).
  Descriptors add a ranking bonus rather than a hard filter, and stated genres
  outrank inferred ones.
- Saved preferences (`user_preferences`: favorite sources and genres) can reuse
  the same filter shape.
- If tag filters prove too coarse, embeddings of a short text card per track
  (title, artists, genres, descriptors, evidence) in pgvector could rank
  candidates semantically. Anthropic does not offer embeddings, so this would use a
  Bedrock embedding model or another provider.
- This phase reintroduces a small per-tape model call, covered by the existing
  daily generation limit.

## Security and privacy

- **Untrusted feed content.** Extraction has no tools, output must match the
  schema, and evidence, titles and artists must appear in the post text. Post text
  is never placed in the system prompt.
- **Outbound requests.** All feed and article fetches follow the
  [URL safety](#url-safety) rules.
- **Tokens.** Refresh and access tokens are encrypted with a customer-managed KMS
  key in `us-east-2`, using the user ID as encryption context. Only the API role
  can decrypt. Discovery and tape generation never handle user tokens.
- **Logs.** Tokens, authorization headers, request bodies and post text never
  appear in logs. Claude calls get paired request/response events with model,
  stop reason, usage and item ID.
- **Deletion.** `DELETE /me` removes the user's tapes, credentials and profile,
  then deletes the Supabase auth user. The UI explains that users can also remove
  the app in their Spotify account settings.
- **Redirects.** Spotify allows only Supabase's callback URL; Supabase allows only
  the app origin and `http://127.0.0.1:<port>` for local development.
- Spotify content is used only to present and play the user's tapes, in line with
  Spotify's developer terms and design guidelines (attribution and artwork).

## Configuration

| Where          | Name                                                                           | Purpose                              |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------ |
| Fetcher        | `DATABASE_URL`, `EXTRACT_QUEUE_URL`                                            |                                      |
| Extractor      | `DATABASE_URL`, `MATCH_QUEUE_URL`, Claude access settings                      | Depends on the model access decision |
| Matcher        | `DATABASE_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_MARKET` | As today                             |
| Tape generator | `DATABASE_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                   | Selection and playability check      |
| API            | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`                    | JWT verification, auth-user deletion |
| API            | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`                                   | Token refresh                        |
| API            | `TOKEN_KMS_KEY_ARN`, `GENERATOR_FUNCTION_NAME`, `APP_ORIGIN`                   |                                      |
| Web            | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`      | Public configuration                 |

New dependencies need explicit approval before installation. Expected:
`@supabase/supabase-js` (web), a Claude SDK client for the chosen access path,
`@aws-sdk/client-kms`, `@aws-sdk/client-lambda`, `@aws-sdk/client-sqs`, a JWT/JWKS
verifier such as `jose`, and possibly an HTML main-content extractor.

## Migration plan

Each phase ends with offline tests, typechecks, bundle checks and updated docs.
Remote migrations and deployments need explicit authorization.

1. **Extraction quality, locally.** Generic RSS/Atom parsing, URL safety,
   HTML-to-text, `packages/extraction` and a preview CLI. Build the labeled
   evaluation set (below) and tune the prompt before any infrastructure.
2. **Discovery pipeline.** Migrations for `feed_items`, `extracted_tracks`,
   `extracted_track_matches` and source changes; fetcher rework; extractor Lambda;
   queues and DLQs; hourly schedule; matcher SQS handler. Re-register Pitchfork
   and the other launch feeds.
3. **Spotify sign-in and users.** `app_users`, `spotify_credentials`, Supabase
   Spotify provider, `apps/api` with the `/me` routes, Connect Spotify UI.
4. **Tape generation.** `mixtapes`, `mixtape_tracks`, tape generator Lambda,
   `POST`/`GET /mixtapes`, limits.
5. **Frontend tapes.** API-backed tape box, ID-based tape identity, generate and
   poll UI; remove `sample-mixtapes.ts`.
6. **Playback.** SDK player module and cassette integration with Premium and
   browser fallbacks.
7. **Save to Spotify.**
8. **Prompt-based tapes** (later): prompt-to-filter call, filtered selection,
   optional saved preferences. See [Future: prompt-based tapes](#future-prompt-based-tapes).
9. **Cleanup.** Remove the Pitchfork adapter and its fixtures, drop `tracks` and
   `track_streaming_matches`, update the README, operations guide, ingestion
   specification and the `AGENTS.md` rules that require per-publisher adapters.

## Testing

- **Extraction evaluation:** a labeled set of real posts from the launch feeds
  (single-song reviews, roundups, album reviews with praised, neutral and criticized
  songs, tracklists, non-music posts) with expected recommended tracks and genres. Measure track precision and recall, and
  genre accuracy (separately for stated and inferred), per prompt, vocabulary or
  model change. Offline unit tests use recorded model responses, not live calls.
- Metadata validation: unknown genres, stated genres without text support demoted
  to inferred, aliases, limits, re-extraction preserving track identity.
- Feed parsing: RSS 2.0, RSS 1.0, Atom, missing GUIDs, HTML content, malformed
  feeds, item limits.
- URL safety: private and loopback addresses, DNS rebinding via pinned resolution,
  redirects to unsafe hosts, size and deadline limits.
- Validation: missing evidence, invented titles or artists, duplicates, limits.
- Extractor: duplicate delivery, unchanged hash, `refusal`, `max_tokens`, partial
  batch failures, track identity preserved across re-extraction.
- Tape selection: song history by Spotify ID, ISRC and identity; one track per
  artist; publication and genre caps; artist cooldown and share penalties across a
  sequence of tapes; seeded jitter reproducibility; relaxation order; shortfall;
  `selection_stats` contents.
- Tape jobs: market playability, claim races, lease expiry.
- Auth: JWT failures, identity mismatch on credential link, refresh-token rotation
  under concurrent requests, revoked credentials.
- Web: reducer with SDK state events, SDK error states, polling backoff and stop.
- Database integration tests against local Supabase for the new stores.

## Risks

| Risk                                                                                                                                         | Impact                           | Mitigation                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| Spotify Development Mode limits the app to allowlisted users; public sign-in needs an approved quota extension with restrictive eligibility. | Blocks "anyone can sign in".     | Confirm quota status before phase 3; launch to allowlisted users first.                     |
| The model extracts songs that the post does not recommend, or invents them.                                                                  | Wrong credits.                   | `kind` classification, verbatim evidence and name checks, evaluation set.                   |
| Feeds with summary-only items or unusual markup.                                                                                             | Missed tracks or extra fetches.  | Article fallback, preview before enabling a source, per-source run reporting.               |
| Model cost grows with feed volume.                                                                                                           | Cost overrun.                    | Content hashes, daily extraction limit, concurrency cap, usage per item; Batches API later. |
| Small track pool for heavy users, since songs never repeat.                                                                                  | `NOT_ENOUGH_TRACKS`.             | Daily generation limit, lookback relaxation, pool size in `selection_stats`, more sources.  |
| Tapes feel repetitive despite distinct songs.                                                                                                | Users lose interest.             | Artist cooldown, publication and genre rotation, diversity measures per tape.               |
| Genres are misclassified, especially inferred ones.                                                                                          | Poor filtering later.            | Fixed vocabulary, stated/inferred split, genre accuracy in the evaluation set.              |
| Spotify rate limits apply to the whole app.                                                                                                  | Matching or generation failures. | Queue concurrency caps; matcher failures retried later.                                     |
| Web Playback SDK requires Premium and desktop browsers.                                                                                      | Some users cannot play in-app.   | Explicit fallback states; saving and "Open in Spotify" still work.                          |

## Open questions

1. **Model access:** Bedrock (if `claude-opus-5-5` is available in `us-east-2`
   without cross-Region inference), Claude Platform on AWS, or an Anthropic API key?
2. **Shortfall:** fail when fewer than 10 tracks qualify, or deliver a shorter tape
   above a minimum?
3. **Launch feeds:** which publications are registered first?
4. **User-submitted feeds:** keep operator-only registration, or let users add
   feeds later (with moderation and per-user cost limits)?
5. **Infrastructure management:** keep console-managed resources, or adopt IaC now
   that queues, schedules, the API, KMS, S3 and CloudFront are added?
6. **Frontend hosting:** S3 + CloudFront in the project, or another host?
7. **Secrets:** Lambda environment variables (current convention) or Secrets
   Manager for the model and Supabase service role keys?
