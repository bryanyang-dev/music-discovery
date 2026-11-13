import { useEffect, useState } from "react";
import { ListeningRoom } from "./listening-room/ListeningRoom.tsx";
import type { Mixtape } from "./listening-room/models.ts";
import { describeTapeLoadError } from "./listening-room/room-status-text.ts";
import {
  fetchSpotifyClientId,
  fetchTapes,
  TapeLoadError,
} from "./listening-room/tape-api.ts";
import type { FloorTheme } from "./listening-room/ThemeLamp.tsx";
import {
  completeSignIn,
  createSignInUrl,
  createSpotifyTokenSource,
  SpotifyAuthError,
  type SpotifyTokenSource,
} from "./spotify/spotify-auth.ts";

/** Spotify redirects back to the app root; register this exact URI in the Spotify app. */
const redirectUri = `${window.location.origin}/`;

const noTapes: readonly Mixtape[] = [];

function preferredTheme(): FloorTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "night"
    : "day";
}

interface SpotifySetup {
  readonly clientId: string;
  readonly tokens: SpotifyTokenSource;
  readonly signInError: string | null;
}

/**
 * Runs once per page load (StrictMode mounts effects twice, and a sign-in code
 * can be exchanged only once).
 */
let spotifySetup: Promise<SpotifySetup> | null = null;

function setUpSpotify(): Promise<SpotifySetup> {
  spotifySetup ??= (async () => {
    const clientId = await fetchSpotifyClientId();
    const callbackUrl = new URL(window.location.href);
    let signInError: string | null = null;
    try {
      await completeSignIn({
        clientId,
        redirectUri,
        callbackUrl,
        pendingStorage: window.sessionStorage,
        tokenStorage: window.localStorage,
      });
    } catch (error) {
      signInError =
        error instanceof SpotifyAuthError
          ? `Spotify sign-in failed (${error.code}).`
          : "Spotify sign-in failed.";
    }
    if (callbackUrl.search) {
      window.history.replaceState(null, "", "/");
    }
    return {
      clientId,
      tokens: createSpotifyTokenSource({
        clientId,
        tokenStorage: window.localStorage,
      }),
      signInError,
    };
  })();
  return spotifySetup;
}

export function App() {
  const [theme, setTheme] = useState<FloorTheme>(preferredTheme);
  const [tapes, setTapes] = useState<readonly Mixtape[]>(noTapes);
  const [setup, setSetup] = useState<SpotifySetup | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const showLoadError = (error: unknown) => {
      if (!cancelled) {
        setNotice(
          describeTapeLoadError(
            error instanceof TapeLoadError ? error.code : "UNKNOWN",
          ),
        );
      }
    };
    fetchTapes().then((loaded) => {
      if (!cancelled) {
        setTapes(loaded);
      }
    }, showLoadError);
    setUpSpotify().then((ready) => {
      if (cancelled) {
        return;
      }
      setSetup(ready);
      setSignedIn(ready.tokens.isSignedIn());
      if (ready.signInError) {
        setNotice(ready.signInError);
      }
    }, showLoadError);
    return () => {
      cancelled = true;
    };
  }, []);

  const connectSpotify = () => {
    if (!setup) {
      return;
    }
    setup.tokens.signOut();
    void createSignInUrl({
      clientId: setup.clientId,
      redirectUri,
      pendingStorage: window.sessionStorage,
    }).then((url) => window.location.assign(url));
  };

  return (
    <ListeningRoom
      theme={theme}
      onToggleTheme={() =>
        setTheme((current) => (current === "day" ? "night" : "day"))
      }
      tapes={tapes}
      spotifyTokens={signedIn && setup ? setup.tokens : null}
      onConnectSpotify={connectSpotify}
      notice={notice}
    />
  );
}
