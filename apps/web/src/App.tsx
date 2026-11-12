import { useState } from "react";
import { FloorSession } from "./floor-session/FloorSession.tsx";
import type { FloorTheme } from "./floor-session/ThemeLamp.tsx";

function preferredTheme(): FloorTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function App() {
  const [theme, setTheme] = useState<FloorTheme>(preferredTheme);
  const [today] = useState(() => new Date());

  return (
    <FloorSession
      theme={theme}
      onToggleTheme={() => setTheme((current) => (current === "day" ? "night" : "day"))}
      today={today}
    />
  );
}
