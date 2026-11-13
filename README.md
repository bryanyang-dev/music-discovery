# Tape Journal

<img width="1469" height="834" alt="ListeningRoomDark" src="https://github.com/user-attachments/assets/bd8dd343-2890-41ea-aa4a-1598e4ba3086" />

## What the app does

Tape Journal turns music discovery into weekly mixtapes: cassettes of songs
recommended by music publications, presented in a cozy virtual listening room.
Each tape holds one review week's recommendations. Drag a tape into the cassette
player, browse its track list (each song links to the review that recommended it)
and play it through Spotify with the player's own controls. The room has day and
night themes.

Behind the room, three local pieces do the work:

- **Ingestion** reads the Pitchfork Best New Tracks RSS feed and stores each
  recommended track in PostgreSQL.
- **Matching** looks each track up in Spotify's catalog and stores its recording
  only when the match is unambiguous.
- **A small local API** groups matched tracks into weekly tapes for the browser,
  which signs in to Spotify and plays them through the Web Playback SDK.

## Limitations

This app runs in Development Mode, where only a small number of accounts that the developer adds by hand can
use it. Opening it to the public needs an extended quota, which Spotify grants
only to established organizations with an existing user base (250K MAU). Tape Journal depends on Spotify for both matching and
playback, so without that quota it cannot serve other users.

## Current state

- **Works end to end locally:** ingest, match, serve, sign in to Spotify and play
  tapes in the browser. Playback has been checked in Chrome.
- **One source:** only Pitchfork Best New Tracks has an adapter. Its feed holds
  about the 30 most recent recommendations, roughly two or three a week.
- **Few playable songs:** of the 30 stored tracks, 10 have a confirmed Spotify
  match. Most of the rest are _ambiguous_ (Spotify has several recordings with the
  same title and artists, such as single and album versions, and the matcher
  will not guess) or not found. As a result each weekly tape usually holds one
  song.
- **Playback requirements:** Spotify Premium and a desktop browser, as required by
  the Web Playback SDK. The Spotify account must be the app owner's or one added
  under User Management in the Spotify developer dashboard.
- **Not hosted:** the API listens only on `127.0.0.1`, has no user accounts, and
  keeps Spotify sign-in tokens in the browser. AWS Lambda versions of ingestion
  and matching still exist (see [operations](docs/operations.md)) but are not
  needed to run the app.

## Developer setup

Use Node.js 24 and pnpm 12.8.1. With dependency installation approved, install
from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

Copy `.env.example` to `.env` and fill in your PostgreSQL connection details and
Spotify app credentials. Before running any database command, export the bundled
CA certificate from the repository root:

```sh
export NODE_EXTRA_CA_CERTS="$PWD/certs/prod-ca-2021.crt"
```

Run this once per terminal session, before starting Node. Without it, TLS
verification fails for source registration, previews, ingestion, matching, the
local API and migrations. Offline fixtures and tests do not need it.

### Running it end to end

1. In the [Spotify developer dashboard](https://developer.spotify.com/dashboard),
   add `http://127.0.0.1:5173/` as a redirect URI of the app whose credentials are
   in `.env`.
2. Collect and match songs:

   ```sh
   pnpm ingest --source pitchfork_best_new_tracks
   pnpm match
   ```

3. Start the local API and the frontend in two terminals:

   ```sh
   pnpm api:dev
   pnpm web:dev
   ```

4. Open <http://127.0.0.1:5173/> (not `localhost`), select **Connect Spotify**,
   then press play on the cassette player.

Only tracks with a confirmed Spotify match appear on tapes. Before Spotify is
connected, the player's controls work but play nothing.

### Sources

To register a source, choose a unique key and run:

```sh
pnpm sources:add \
  --key my_pitchfork_feed \
  --name pitchfork \
  --category best_new_track \
  --feed-url https://pitchfork.com/feed/reviews/best/tracks/rss
```

Registration writes the source configuration to the database. Only Pitchfork Best
New Tracks is currently supported; another publication needs its own adapter
before it can be registered. Preview the registered source without writes, then
ingest it:

```sh
pnpm ingest:preview --source my_pitchfork_feed
pnpm ingest --source my_pitchfork_feed
```

See [operations](docs/operations.md) for the local API, matching, database
permissions, source configuration and Lambda releases.

Useful development commands:

| Command               | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `pnpm ingest:fixture` | Preview ingestion offline without a database |
| `pnpm match`          | Match unmatched tracks to Spotify            |
| `pnpm api:dev`        | Serve tapes to the frontend on 127.0.0.1     |
| `pnpm typecheck`      | Check backend and frontend TypeScript        |
| `pnpm test`           | Run offline tests                            |
| `pnpm format`         | Format the workspace                         |
| `pnpm format:check`   | Check formatting                             |
| `pnpm web:build`      | Build the frontend                           |

For backend design details, see the [ingestion specification](docs/ingestion-spec.md)
and [timing guide](docs/timing-and-policies.md).
