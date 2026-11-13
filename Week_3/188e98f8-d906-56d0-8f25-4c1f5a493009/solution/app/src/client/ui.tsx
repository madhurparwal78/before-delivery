import { useEffect, useId, useRef } from "react";
import type { ChangeEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { LIMITS, countCodePoints } from "../shared/text";
import { useCascade } from "./cascade";
import { STATUS_WORD } from "./copy";
import { useLeague } from "./league";
import { fade } from "./motion";
import { Link } from "./router";
import { useSession } from "./session";

export function CoasterMark({ size = 40 }: { size?: number }) {
  return (
    <svg className="coaster" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill="var(--ground)" stroke="var(--ink)" strokeWidth="2" />
      <circle cx="24" cy="24" r="17" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
      <circle cx="24" cy="24" r="10" fill="var(--muted)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M24 18v12M18 24h12" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Masthead() {
  const { night } = useLeague();
  const { state, signOut } = useSession();
  return (
    <div className="masthead">
      <Link to="/" className="brand">
        <CoasterMark />
        <span className="brand-text">
          <span className="brand-name">Roundkeeper</span>
          <span className="brand-line">
            <span className="league">Snug Thursday League</span>
            <span className="night">{night === null ? "Night" : `Night ${night}`}</span>
          </span>
        </span>
      </Link>
      {state.status === "in" && (
        <button type="button" className="btn quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      )}
    </div>
  );
}

function RoundStrip() {
  const { rounds } = useLeague();
  return (
    <ul className="strip" aria-label="Rounds tonight" tabIndex={0}>
      {rounds === null
        ? Array.from({ length: 8 }, (_, index) => (
            <li key={`loading-${index}`} className="chip" data-status="loading" aria-hidden="true">
              Round {index + 1} · …
            </li>
          ))
        : rounds.map((round) => (
            <li key={round.number} className="chip" data-status={round.status}>
              Round {round.number} · {STATUS_WORD[round.status]}
            </li>
          ))}
    </ul>
  );
}

export function Banner() {
  return (
    <header className="banner">
      <Masthead />
      <RoundStrip />
    </header>
  );
}

export function Empty({ children, size = 72 }: { children: ReactNode; size?: number }) {
  return (
    <div className="empty">
      <CoasterMark size={size} />
      <p>{children}</p>
    </div>
  );
}

function TileSection({ level }: { level: 1 | 2 }) {
  const { table } = useLeague();
  const { tiles, news, fadeKey, cell } = useCascade(table);
  const grid = useRef<HTMLUListElement>(null);
  const Heading = level === 1 ? "h1" : "h2";

  useEffect(() => {
    if (fadeKey > 0) grid.current?.querySelectorAll("article").forEach((tile) => fade(tile));
  }, [fadeKey]);

  return (
    <section className="league-table">
      <Heading className="section-title">League table</Heading>
      <div role="status" aria-label="Table news" className="table-news">
        {news}
      </div>
      {tiles === null ? (
        <div className="tiles" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="tile placeholder" />
          ))}
        </div>
      ) : (
        <ul className="tiles" aria-label="League table" ref={grid}>
          {tiles.map((tile) => {
            const transform =
              tile.angle === 0 && tile.slide === null
                ? undefined
                : `perspective(1200px) translate(${tile.slide?.x ?? 0}px, ${tile.slide?.y ?? 0}px) rotateY(${tile.angle}deg)`;
            return (
              <li key={tile.teamId} ref={cell(tile.teamId)} className="tile-cell">
                <article
                  className="tile"
                  tabIndex={0}
                  aria-label={tile.name}
                  data-leader={tile.position === 1}
                  style={transform === undefined ? undefined : { transform }}
                >
                  <div className="tile-face" data-mirrored={tile.mirrored}>
                    <span className="tile-position">{tile.position}</span>
                    <span className="tile-name">{tile.name}</span>
                    <span className="tile-total">{tile.total} pts</span>
                    {tile.lastRound !== null && (
                      <span className="tile-round">
                        Round {tile.lastRound.round}: {tile.lastRound.score}
                      </span>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface LimitedFieldProps {
  label: string;
  value: string;
  onValue: (value: string) => void;
  limit: keyof typeof LIMITS;
  overCopy: string;
  /** Copy of a server refusal; it stays until the value changes. */
  refusal?: string | undefined;
  multiline?: boolean;
  type?: "text" | "search";
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement & HTMLTextAreaElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => void;
  enterKeyHint?: "next" | "go" | "search" | "done";
  autoComplete?: string;
}

/** A limited text field: a live `used/limit` counter counted as the server counts, and its error copy. */
export function LimitedField(props: LimitedFieldProps) {
  const { label, value, onValue, limit, overCopy, refusal, multiline, type = "text", readOnly, inputRef, onKeyDown } = props;
  const id = useId();
  const used = countCodePoints(value);
  const over = used > LIMITS[limit];
  const message = over ? overCopy : refusal;
  const common = {
    id,
    value,
    readOnly,
    ref: inputRef,
    onKeyDown,
    "aria-invalid": over || refusal !== undefined,
    "aria-describedby": `${id}-count ${id}-error`,
    autoComplete: props.autoComplete ?? "off",
    enterKeyHint: props.enterKeyHint,
    onChange: (event: ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onValue(event.target.value),
  };
  return (
    <div className="field" data-invalid={over || refusal !== undefined}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={4} {...common} /> : <input type={type} {...common} />}
      <div className="field-foot">
        <span id={`${id}-error`} className="field-error" aria-live="polite">
          {message}
        </span>
        <span id={`${id}-count`} className="counter" data-over={over}>
          {used}/{LIMITS[limit]}
        </span>
      </div>
    </div>
  );
}

export function Page({ children, level }: { children?: ReactNode; level?: 1 | 2 }) {
  return (
    <>
      <Banner />
      <main className="page">
        {children}
        {level !== undefined && <TileSection level={level} />}
      </main>
    </>
  );
}

