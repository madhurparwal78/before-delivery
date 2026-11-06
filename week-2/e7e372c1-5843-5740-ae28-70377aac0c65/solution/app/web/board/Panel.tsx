import { forwardRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CloseIcon, DownloadIcon } from "../icons.tsx";
import { CLOCK_BADGES, UNEXPECTED, VAULT_DOWNLOAD } from "../copy.ts";
import type { Computation, ComputationInput } from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

const FORMULA_WORDS: Record<Computation["figure"], string> = {
  "eth-held": "Beginning ETH balance + ETH acquired + Staking rewards",
  "staking-rewards": "Cumulative staking rewards as filed",
  "eth-per-1000-diluted": "Ending ETH balance ÷ Assumed diluted shares × 1,000",
  mnav: "(Share price × Assumed diluted shares) ÷ (Ending ETH balance × ETH price)",
};

export function liveTime(input: ComputationInput): string | null {
  return input.source.kind === "tick" ? `Last tick ${isoWallClock(input.source.at, true)} ET` : null;
}

export function asOfText(input: ComputationInput): string {
  return `As of ${isoWallDate(input.as_of)} ${isoWallClock(input.as_of, true)} ET`;
}

function selectedDetail(input: ComputationInput): string {
  if (input.source.kind === "tick") return `Last tick ${isoWallClock(input.source.at, true)} ET`;
  if (input.source.kind === "official_close") return `Official close ${input.source.date} at ${isoWallClock(input.as_of, false)} ET`;
  return `Filed in the exhibit: ${input.source.row}`;
}

async function saveExhibit(sha256: string, accession: string, say: (message: string) => void): Promise<void> {
  say("");
  let response: Response;
  try {
    response = await fetch(`/api/exhibits/${sha256}`, { credentials: "same-origin" });
  } catch {
    say(VAULT_DOWNLOAD);
    return;
  }
  if (response.status === 503) {
    say(VAULT_DOWNLOAD);
    return;
  }
  if (response.status !== 200) {
    say(UNEXPECTED);
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${accession}.pdf`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface PanelProps {
  computation: Computation;
  selected: string;
  citeHref: string | null;
  closing: boolean;
  onSelect: (key: string) => void;
  onClose: () => void;
  onStep: (step: 1 | -1) => void;
}

const FOCUSABLE = "button:not(:disabled), a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ computation, selected, citeHref, closing, onSelect, onClose, onStep }, ref) {
  const [downloadMessage, setDownloadMessage] = useState("");
  const { exhibit } = computation;
  const chosen = computation.inputs.find((input) => input.key === selected) ?? computation.inputs[0];
  const title = `Trace: ${computation.label}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "]") {
      event.preventDefault();
      onStep(1);
    } else if (event.key === "[") {
      event.preventDefault();
      onStep(-1);
    } else if (event.key === "Tab") {
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const onOpenExhibit = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void saveExhibit(exhibit.sha256, exhibit.accession, setDownloadMessage);
  };

  return (
    <div className="trace-panel" role="dialog" aria-label={title} ref={ref} onKeyDown={onKeyDown} inert={closing}>
      <div className="trace-head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close trace">
          Close <CloseIcon />
        </button>
      </div>
      <div className="trace-figure">
        <span className="numeral">{computation.display}</span>
        <span className="formula-words">{FORMULA_WORDS[computation.figure]}</span>
      </div>
      <ul className="input-list" aria-label="Inputs">
        {computation.inputs.map((input) => {
          const tick = liveTime(input);
          return (
            <li className="input-item" key={input.key} onClick={() => onSelect(input.key)}>
              <button type="button" className={input.sets_as_of ? "input-button sets-as-of" : "input-button"} aria-pressed={input.key === selected} aria-label={input.label} onClick={(event) => { event.stopPropagation(); onSelect(input.key); }}>
                {input.label}
              </button>
              <span className="input-detail">
                <span className="badge">{CLOCK_BADGES[input.clock]}</span>
                <span>{asOfText(input)}</span>
                {tick && <span className="mono">{tick}</span>}
                {input.sets_as_of && <span className="sets">Sets as-of</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {chosen && (
        <div className="trace-selected">
          <strong>{chosen.label}</strong>
          <span className="mono">{chosen.display}</span>
          <span>{selectedDetail(chosen)}</span>
        </div>
      )}
      <table className="exhibit-table" aria-label={`Exhibit ${exhibit.accession} page ${exhibit.page}`}>
        <caption>Exhibit table as filed</caption>
        <tbody>
          {exhibit.rows.map((row) => (
            <tr key={row.key} data-row-key={row.key} aria-current={chosen?.source.kind === "exhibit" && chosen.key === row.key ? "true" : undefined}>
              <th scope="row">{row.label}</th>
              <td className="amount">{row.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="trace-provenance">
        <p>Accession {exhibit.accession}</p>
        <p>
          SHA-256 <span className="hash">{exhibit.sha256}</span>
        </p>
      </div>
      <div className="trace-actions">
        <a className="link-action" href={`/api/exhibits/${exhibit.sha256}`} aria-label={`Open exhibit ${exhibit.accession}`} onClick={onOpenExhibit}>
          Open exhibit <DownloadIcon />
        </a>
        {citeHref && (
          <a className="link-action" href={citeHref}>
            Cite this figure
          </a>
        )}
      </div>
      <p className="trace-status" role="status" aria-label="Exhibit download">
        {downloadMessage}
      </p>
    </div>
  );
});
