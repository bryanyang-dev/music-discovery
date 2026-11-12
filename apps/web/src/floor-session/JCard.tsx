import type { Mixtape } from "./models.ts";
import { describeTapeDate } from "./tape-date-labels.ts";

interface JCardProps {
  readonly tape: Mixtape;
  readonly trackIndex: number;
}

/** The unfolded cassette insert: painted sky cover, date and the Side A track list. */
export function JCard({ tape, trackIndex }: JCardProps) {
  const labels = describeTapeDate(tape.date);

  return (
    <>
      <section className="j-card" aria-label={`Track list for ${labels.spokenDate}`}>
        <div className="j-card__cover">
          <svg className="j-card__art" width="150" height="245" viewBox="0 0 150 245" aria-hidden="true">
            <g className="night-only">
              <circle className="j-card__moon" cx="114" cy="46" r="15" />
              <g className="j-card__stars">
                <circle cx="96" cy="18" r="1.6" />
                <circle cx="134" cy="84" r="1.4" />
                <circle cx="22" cy="104" r="1.6" />
                <circle cx="60" cy="96" r="1.2" />
                <circle cx="88" cy="74" r="1.4" />
                <circle cx="138" cy="16" r="1.2" />
              </g>
            </g>
            <g className="j-card__cloud-shade">
              <circle cx="38" cy="150" r="24" />
              <circle cx="70" cy="132" r="34" />
              <circle cx="106" cy="150" r="27" />
              <rect x="14" y="150" width="120" height="26" rx="13" />
            </g>
            <g className="j-card__cloud">
              <circle cx="38" cy="142" r="22" />
              <circle cx="70" cy="122" r="32" />
              <circle cx="104" cy="140" r="25" />
              <rect x="18" y="140" width="110" height="20" rx="10" />
            </g>
            <g className="j-card__wires">
              <path d="M118 245V186M104 196h28M108 206h20" />
              <path d="M0 204c40 10 76 6 104-8M0 216c44 8 78 4 108-10" />
            </g>
          </svg>
          <div className="j-card__date">
            <div className="j-card__month">{labels.monthCode}</div>
            <div className="j-card__day">{labels.dayOfMonth}</div>
          </div>
        </div>

        <div className="j-card__body">
          <div className="j-card__heading">
            <div className="j-card__side">
              SIDE A<span lang="ja"> ・ A面</span>
            </div>
            <div className="j-card__weekday">
              {labels.weekdayCode}
              <span lang="ja"> ・ {labels.weekdayJapanese}</span>
            </div>
          </div>
          <ol className="j-card__tracks">
            {tape.tracks.map((track, index) => {
              const isCurrent = index === trackIndex;
              return (
                <li
                  key={index}
                  className={isCurrent ? "j-card__track j-card__track--current" : "j-card__track"}
                  aria-current={isCurrent ? "true" : undefined}
                >
                  {track.title} · {track.artist}
                </li>
              );
            })}
          </ol>
        </div>
      </section>
      <div className="j-card-spine" aria-hidden="true" />
    </>
  );
}
