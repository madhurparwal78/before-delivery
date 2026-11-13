// The four markdown stations: one Tab stop, arrows inside, and a popover kept inside the viewport.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { brusselsDate } from "../../shared/brussels";
import type { Station } from "../../shared/api";
import { formatDate, formatDateTime, formatMoney } from "../../shared/format";
import { useMedia, useOverlayPhase } from "../hooks";

const MARKDOWNS: ReadonlySet<string> = new Set(["off_25", "off_50"]);

function Popover({ station, anchor, open, onClose }: { station: Station; anchor: HTMLElement | null; open: boolean; onClose: () => void }) {
  const { mounted, closing, onAnimationEnd } = useOverlayPhase(open);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const panel = box.current;
    if (!panel || !anchor) return;
    const margin = 12;
    const target = anchor.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const below = target.bottom + 8 + size.height <= window.innerHeight - margin;
    const top = below ? target.bottom + 8 : Math.max(margin, target.top - 8 - size.height);
    const label = anchor.querySelector(".station-label")?.getBoundingClientRect().left ?? target.left;
    const left = Math.min(Math.max(margin, label), window.innerWidth - margin - size.width);
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }, [anchor, mounted, station]);

  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      ref={box}
      className={`popover${closing ? " closing" : ""}`}
      role="dialog"
      aria-label={station.label}
      inert={closing}
      onAnimationEnd={(event) => {
        if (event.target === box.current && closing) onAnimationEnd();
      }}
    >
      <p className="popover-title">{station.label}</p>
      <p className="num">{formatDateTime(station.at)}</p>
      {station.priceCents !== null && <p className="num">From this station: {formatMoney(station.priceCents)}</p>}
      <button ref={close} type="button" className="button secondary" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function Stations({ stations }: { stations: Station[] }) {
  const current = Math.max(0, stations.findIndex((station) => station.state === "current"));
  const [rove, setRove] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [lastOpen, setLastOpen] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const stacked = useMedia("(max-width: 767px)");
  const tabStop = rove ?? current;

  const moveTo = (index: number): void => {
    setRove(index);
    buttons.current[index]?.focus();
  };

  const closePopover = useCallback(() => {
    setOpenIndex((open) => {
      if (open !== null) buttons.current[open]?.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") closePopover();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openIndex, closePopover]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = stations.length - 1;
    const next = event.key === "ArrowRight" || (stacked && event.key === "ArrowDown") ? Math.min(last, index + 1) : event.key === "ArrowLeft" || (stacked && event.key === "ArrowUp") ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next !== null) {
      event.preventDefault();
      moveTo(next);
    }
  };

  const shown = stations[openIndex ?? lastOpen];
  return (
    <>
    <div
      className="stations"
      role="toolbar"
      aria-label="Markdown stations"
      aria-orientation={stacked ? "vertical" : "horizontal"}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && openIndex === null) setRove(null);
      }}
    >
      {stations.map((station, index) => (
        <div key={station.station} className={`station-cell ${station.state}`}>
          <button
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            className={`station ${station.state}${MARKDOWNS.has(station.station) ? " markdown" : ""}`}
            data-station={station.station}
            data-state={station.state}
            data-at={station.at}
            aria-label={`${station.label}, ${formatDate(brusselsDate(new Date(station.at)))}`}
            tabIndex={index === tabStop ? 0 : -1}
            onFocus={() => setRove(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => {
              setLastOpen(index);
              setOpenIndex(index);
            }}
          >
            <span className="station-dot" aria-hidden="true" />
            <span className="station-label">{station.label}</span>{" "}
            <span className="station-date num">{formatDate(brusselsDate(new Date(station.at)))}</span>
          </button>
          <span className="station-state">{station.state === "current" ? "Now" : station.state === "done" ? "Passed" : "Coming"}</span>
        </div>
      ))}
    </div>
    {shown && <Popover station={shown} anchor={buttons.current[openIndex ?? lastOpen] ?? null} open={openIndex !== null} onClose={closePopover} />}
    </>
  );
}
