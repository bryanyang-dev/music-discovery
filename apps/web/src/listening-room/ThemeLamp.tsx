export type FloorTheme = "day" | "night";

interface ThemeLampProps {
  readonly theme: FloorTheme;
  readonly onToggleTheme: () => void;
}

/** The paper lamp is the theme switch: unlit by day, lit (with its glow on the floor) at night. */
export function ThemeLamp({ theme, onToggleTheme }: ThemeLampProps) {
  const otherTheme: FloorTheme = theme === "day" ? "night" : "day";

  return (
    <>
      <div className="night-only" aria-hidden="true">
        <div className="lamp-glow" />
      </div>
      <button
        type="button"
        className="theme-lamp"
        aria-label={`Switch to the ${otherTheme} theme`}
        onClick={onToggleTheme}
      >
        <span className="theme-lamp__knob" aria-hidden="true" />
      </button>
      <div className="floor-pill theme-lamp__hint" aria-hidden="true">
        Tap the lamp for {otherTheme}
      </div>
    </>
  );
}
