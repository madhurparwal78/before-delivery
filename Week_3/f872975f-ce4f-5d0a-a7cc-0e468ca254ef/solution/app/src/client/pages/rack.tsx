// The rack: live filters kept in the address bar, and every listed board drawn at one shared scale.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardSummary, Lot } from "../../shared/api";
import { BOARD_LABELS, GRADE_TALLY, GRADES, lengthText, money, SPECIES, type Unit } from "../../shared/domain";
import { api, useMedia, useUnit } from "../api";
import { Link } from "../app";
import { Dialog } from "../dialog";
import { Strip } from "../drawing";

interface Filters {
  species: string[];
  grade: string[];
  minLength: string;
  minClear: string;
  lot: string;
}

const validNumber = (v: string): boolean => /^\d+$/.test(v) && Number(v) <= 12_000;

/** Reads the address; values that are not integers 0–12,000 or unknown names are dropped. */
function readAddress(search: string): Filters {
  const p = new URLSearchParams(search);
  const number = (k: string): string => {
    const v = p.get(k) ?? "";
    return validNumber(v) ? String(Number(v)) : "";
  };
  return {
    species: [...new Set(p.getAll("species").filter((s) => (SPECIES as readonly string[]).includes(s)))],
    grade: [...new Set(p.getAll("grade").filter((g) => (GRADES as readonly string[]).includes(g)))],
    minLength: number("min_length_mm"),
    minClear: number("min_clear_mm"),
    lot: p.get("lot") ?? "",
  };
}

/** The API's parameter names, in the published order; empty filters are left out. */
function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  for (const s of f.species) p.append("species", s);
  for (const g of f.grade) p.append("grade", g);
  if (validNumber(f.minLength)) p.append("min_length_mm", f.minLength);
  if (validNumber(f.minClear)) p.append("min_clear_mm", f.minClear);
  if (f.lot) p.append("lot", f.lot);
  return p.toString();
}

const countCopy = (n: number): string => (n === 0 ? "No boards match these filters" : n === 1 ? "1 board on the rack" : `${n} boards on the rack`);

function dims(b: { length_mm: number; width_mm: number; thickness_mm: number }, unit: Unit): string {
  if (unit === "mm") return `${b.length_mm} × ${b.width_mm} × ${b.thickness_mm} mm`;
  return [b.length_mm, b.width_mm, b.thickness_mm].map((v) => lengthText(v, unit)).join(" × ");
}

function FilterControls({ filters, lots, onChange }: { filters: Filters; lots: Lot[]; onChange: (f: Filters) => void }) {
  const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  return (
    <div className="filters">
      <fieldset className="checks">
        <legend>Species</legend>
        {SPECIES.map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={filters.species.includes(s)} onChange={() => onChange({ ...filters, species: toggle(filters.species, s) })} />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="checks">
        <legend>Grade</legend>
        {GRADES.map((g) => (
          <label key={g} className="check">
            <input type="checkbox" checked={filters.grade.includes(g)} onChange={() => onChange({ ...filters, grade: toggle(filters.grade, g) })} />
            <span>{g}</span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Minimum length (mm)</span>
        <input type="text" inputMode="numeric" className="mono" value={filters.minLength} onChange={(e) => onChange({ ...filters, minLength: e.target.value.trim() })} />
      </label>
      <label className="field">
        <span>Minimum clear run (mm)</span>
        <input type="text" inputMode="numeric" className="mono" value={filters.minClear} onChange={(e) => onChange({ ...filters, minClear: e.target.value.trim() })} />
      </label>
      <label className="field">
        <span>Salvage lot</span>
        <select value={filters.lot} onChange={(e) => onChange({ ...filters, lot: e.target.value })}>
          <option value="">All lots</option>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function RackRow({ board, scale, stripWidth, unit, measureRef }: {
  board: BoardSummary; scale: number; stripWidth: number; unit: Unit; measureRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <li className="rack-row">
      <div className="strip-cell" ref={measureRef}>
        <Strip
          label={`Board ${board.tag}`}
          width={stripWidth}
          scale={scale}
          lengthMm={board.length_mm}
          defects={board.defects}
          boardHeight={26}
          {...(board.grade ? { tally: GRADE_TALLY[board.grade] } : {})}
        />
      </div>
      <div className="rack-text">
        <div className="rack-head">
          <Link to={`/boards/${board.tag}`} className="tag-link mono">{board.tag}</Link>
          {board.status === "held" && <span className="badge held">{BOARD_LABELS.held}</span>}
        </div>
        <div className="rack-meta">{board.species} · {board.lot.name}</div>
        <div className="mono measure">{dims(board, unit)}</div>
        <div className="mono">{board.board_feet} bd ft{board.price_cents !== null && <> · <strong>${money(board.price_cents)}</strong></>}</div>
      </div>
    </li>
  );
}

export function RackPage() {
  const unit = useUnit();
  const phone = useMedia("(max-width: 767px)");
  const [filters, setFilters] = useState<Filters>(() => readAddress(window.location.search));
  const [lots, setLots] = useState<Lot[]>([]);
  const [result, setResult] = useState<{ count: number; boards: BoardSummary[] } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stripWidth, setStripWidth] = useState(0);
  const latest = useRef(0);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    void api<{ lots: Lot[] }>("GET", "/api/lots").then((r) => {
      if (!r.ok) return;
      setLots(r.data.lots);
      setFilters((f) => (f.lot && !r.data.lots.some((l) => l.id === f.lot) ? { ...f, lot: "" } : f));
    });
  }, []);

  useEffect(() => {
    const query = toQuery(filters);
    const address = query ? `/?${query}` : "/";
    if (window.location.pathname + window.location.search !== address) window.history.replaceState(null, "", address);
    const seq = ++latest.current;
    void api<{ count: number; boards: BoardSummary[] }>("GET", `/api/boards${query ? `?${query}` : ""}`).then((r) => {
      if (seq !== latest.current || !r.ok) return;
      setResult(r.data);
    });
  }, [filters]);

  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (el === null) return;
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setStripWidth(Math.floor(entry.contentRect.width));
    });
    observer.current.observe(el);
  }, []);

  const longest = Math.max(1, ...(result?.boards ?? []).map((b) => b.length_mm));
  const scale = stripWidth / longest;
  const controls = <FilterControls filters={filters} lots={lots} onChange={setFilters} />;

  return (
    <div className="rack-page">
      <div className="rack-title">
        <h1>The rack</h1>
        <div role="status" aria-label="Rack count" className="count">{result ? countCopy(result.count) : ""}</div>
      </div>
      {phone ? (
        <>
          <button ref={filtersButton} type="button" className="quiet filters-button" onClick={() => setSheetOpen(true)}>Filters</button>
          <Dialog open={sheetOpen} title="Filters" variant="sheet" onClose={() => setSheetOpen(false)} returnFocus={filtersButton}>
            {controls}
            <button type="button" className="primary" onClick={() => setSheetOpen(false)}>Done</button>
          </Dialog>
        </>
      ) : (
        <aside className="filter-rail" aria-label="Rack filters">{controls}</aside>
      )}
      <div className="rack-area">
        {result === null && <div className="placeholder-rows" aria-hidden="true"><div /><div /><div /></div>}
        <ul aria-label="Rack" className="rack">
          {(result?.boards ?? []).map((b, i) => (
            <RackRow key={b.tag} board={b} scale={scale} stripWidth={stripWidth} unit={unit} {...(i === 0 ? { measureRef: measure } : {})} />
          ))}
        </ul>
        {result?.count === 0 && (
          <svg className="empty-bay" viewBox="0 0 240 60" width="240" height="60" aria-hidden="true">
            <line x1="0" y1="10" x2="240" y2="10" />
            <line x1="0" y1="50" x2="240" y2="50" />
            <line x1="20" y1="10" x2="20" y2="50" />
            <line x1="220" y1="10" x2="220" y2="50" />
          </svg>
        )}
      </div>
    </div>
  );
}
