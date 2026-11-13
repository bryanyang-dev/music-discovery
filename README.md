# Tape Journal

<img width="1469" height="834" alt="ListeningRoomDark" src="https://github.com/user-attachments/assets/bd8dd343-2890-41ea-aa4a-1598e4ba3086" />

## What the app does

Tape Journal turns music discovery into weekly mixtapes: cassettes of songs
recommended by music publications, presented in a cozy virtual listening room.
Each tape holds one review week's recommendations. Load a tape into the player,
browse its track list (each links to its review) and play it through Spotify. The
room has day and night themes.

It is a personal project that runs locally and is not hosted. Pitchfork Best New
Tracks recommendations are collected into PostgreSQL, matched to Spotify
recordings, and served to the browser by a small local API. Playback uses the
Spotify Web Playback SDK, which needs Spotify Premium and a desktop browser.

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
