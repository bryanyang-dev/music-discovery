# Tape Journal

<img width="1469" height="834" alt="ListeningRoomDark" src="https://github.com/user-attachments/assets/bd8dd343-2890-41ea-aa4a-1598e4ba3086" />

## What the app does

Tape Journal turns music discovery into a daily mixtape: a cassette of songs
recommended by curated music blogs and publications, presented in a cozy virtual
listening room. Browse the week's tapes, load one into the player, and explore
its track list. The room has day and night themes.

The frontend currently uses sample tapes and visual player controls; audio
playback and backend integration are still to come. Behind the scenes, separate
services collect Pitchfork Best New Tracks recommendations into PostgreSQL and
match stored tracks to Spotify recordings.

## Developer setup

Use Node.js 24 and pnpm 12.8.1. With dependency installation approved, install
from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

Start the frontend:

```sh
pnpm web:dev
```

The listening-room prototype needs no database or credentials. To work on
backend ingestion, copy `.env.example` to `.env` and fill in your PostgreSQL
connection details. See [operations](docs/operations.md) for source configuration,
database permissions and Lambda releases.

Useful development commands:

| Command               | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `pnpm ingest:fixture` | Preview ingestion offline without a database |
| `pnpm typecheck`      | Check backend and frontend TypeScript        |
| `pnpm test`           | Run offline tests                            |
| `pnpm format`         | Format the workspace                         |
| `pnpm format:check`   | Check formatting                             |
| `pnpm web:build`      | Build the frontend                           |

For backend design details, see the [ingestion specification](docs/ingestion-spec.md)
and [timing guide](docs/timing-and-policies.md).
