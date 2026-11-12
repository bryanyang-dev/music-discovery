const sparklePath = "M10 0L12.5 7.5 20 10 12.5 12.5 10 20 7.5 12.5 0 10 7.5 7.5z";

export function IcedTea() {
  return (
    <div aria-hidden="true">
      <div className="iced-tea__glass" />
      <div className="iced-tea__ice iced-tea__ice--1" />
      <div className="iced-tea__ice iced-tea__ice--2" />
    </div>
  );
}

interface SparkleProps {
  /** Which object the glint belongs to; it moves with that object. */
  readonly owner: "player" | "box";
}

export function Sparkle({ owner }: SparkleProps) {
  const sizePx = owner === "player" ? 30 : 18;
  return (
    <svg className={`sparkle sparkle--${owner}`} width={sizePx} height={sizePx} viewBox="0 0 20 20" aria-hidden="true">
      <path d={sparklePath} />
    </svg>
  );
}

export function SleepingCat() {
  return (
    <svg
      className="sleeping-cat"
      role="img"
      aria-label="A ginger cat curled up asleep"
      width="270"
      height="210"
      viewBox="0 0 270 210"
    >
      <ellipse className="sleeping-cat__shadow" cx="146" cy="124" rx="96" ry="70" />
      <path className="sleeping-cat__tail-outline" d="M222 110C236 184 130 200 84 166" />
      <path className="sleeping-cat__tail" d="M222 110C236 184 130 200 84 166" />
      <ellipse className="sleeping-cat__body" cx="134" cy="108" rx="94" ry="68" />
      <ellipse className="sleeping-cat__fur" cx="126" cy="100" rx="82" ry="56" />
      <path className="sleeping-cat__stripes" d="M130 52c6 12 6 22 0 34M162 56c6 12 6 22 0 32M192 70c5 9 5 17 0 26" />
      <path className="sleeping-cat__ears" d="M34 98L18 66 56 84zM40 150L22 176 62 160z" />
      <circle className="sleeping-cat__head" cx="64" cy="122" r="38" />
      <path className="sleeping-cat__eyes" d="M44 108q5 6 11 0M44 134q5 6 11 0" />
      <circle className="sleeping-cat__nose" cx="31" cy="122" r="3.5" />
    </svg>
  );
}
