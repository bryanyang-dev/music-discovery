import { useState } from "react";
import { ListeningRoom } from "./listening-room/ListeningRoom.tsx";
import type { FloorTheme } from "./listening-room/ThemeLamp.tsx";

function preferredTheme(): FloorTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "night"
    : "day";
}

export function App() {
  const [theme, setTheme] = useState<FloorTheme>(preferredTheme);
  const [today] = useState(() => new Date());

  return (
    <ListeningRoom
      theme={theme}
      onToggleTheme={() =>
        setTheme((current) => (current === "day" ? "night" : "day"))
      }
      today={today}
    />
  );
}
