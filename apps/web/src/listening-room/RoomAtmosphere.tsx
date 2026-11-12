const windowPaneCount = 12;
const dustMoteCount = 5;

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** Tatami borders plus the room's light: sun, leaf shadows and dust by day; moon and headlights at night. */
export function RoomAtmosphere() {
  return (
    <div aria-hidden="true">
      <div className="tatami-border tatami-border--1" />
      <div className="tatami-border tatami-border--2" />
      <div className="tatami-border tatami-border--3" />
      <div className="tatami-border tatami-border--4" />
      <div className="tatami-border tatami-border--5" />

      <div className="room-shade" />
      <div className="window-light">
        {range(windowPaneCount).map((pane) => (
          <div key={pane} className="window-light__pane" />
        ))}
      </div>
      <svg
        className="leaf-shadows"
        width="240"
        height="280"
        viewBox="0 0 240 280"
      >
        <ellipse
          cx="60"
          cy="60"
          rx="52"
          ry="16"
          transform="rotate(-35 60 60)"
        />
        <ellipse
          cx="150"
          cy="70"
          rx="58"
          ry="17"
          transform="rotate(20 150 70)"
        />
        <ellipse
          cx="100"
          cy="150"
          rx="60"
          ry="18"
          transform="rotate(-60 100 150)"
        />
        <ellipse
          cx="180"
          cy="180"
          rx="50"
          ry="15"
          transform="rotate(48 180 180)"
        />
        <ellipse
          cx="70"
          cy="230"
          rx="46"
          ry="14"
          transform="rotate(-18 70 230)"
        />
      </svg>

      <div className="day-only">
        {range(dustMoteCount).map((mote) => (
          <div key={mote} className={`dust-mote dust-mote--${mote + 1}`} />
        ))}
      </div>
      <div className="night-only">
        <div className="headlight-sweep" />
      </div>
    </div>
  );
}
