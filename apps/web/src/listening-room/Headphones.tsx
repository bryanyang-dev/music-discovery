const notePaths = {
  head: { cx: 7, cy: 16, rx: 4, ry: 3 },
  stem: "M11 16V3c3 1 5 3 5 6",
} as const;

const notes = [
  { className: "headphones__note headphones__note--1", size: 26 },
  { className: "headphones__note headphones__note--2", size: 22 },
  { className: "headphones__note headphones__note--3", size: 26 },
  { className: "headphones__note headphones__note--4", size: 22 },
] as const;

interface HeadphonesProps {
  readonly playing: boolean;
}

/** Headphones on the floor. The cups pulse and notes drift off them while the tape plays. */
export function Headphones({ playing }: HeadphonesProps) {
  return (
    <div aria-hidden="true">
      <div className="headphones__band" />
      <div className="headphones__cup headphones__cup--left" />
      <div className="headphones__cup headphones__cup--right" />
      <div className="headphones__shine headphones__shine--left" />
      <div className="headphones__shine headphones__shine--right" />
      <svg className="headphones__cable" width="260" height="140" viewBox="0 0 260 140">
        <path d="M12 10 C -10 90, 60 130, 130 70 S 200 40, 240 60" />
      </svg>
      {playing
        ? notes.map((note) => (
            <svg key={note.className} className={note.className} width={note.size} height={note.size} viewBox="0 0 20 20">
              <ellipse className="headphones__note-head" {...notePaths.head} />
              <path className="headphones__note-stem" d={notePaths.stem} />
            </svg>
          ))
        : null}
    </div>
  );
}
