import { useEffect, useRef, useState } from "preact/hooks";
import { type Board, type GalleryItem, type LeaderCategory, type Program, get } from "../api";
import { useBand, useDesk } from "../desk";
import { SelectField } from "../form";
import { AWARD_LABEL, Marker } from "../icons";
import type { Ledger, LedgerRow } from "../shuffle";
import { StandingsTable } from "../standings";

// The leaderboard and the gallery (brief: Screens and layout; Public).

const REFRESH_MS = 5000;

function finalRows(category: LeaderCategory): LedgerRow[] {
  return category.rows.map((r) => ({
    key: String(r.entryNumber), rank: r.rank, entryNumber: r.entryNumber, title: r.title, meta: r.studioName,
    category: category.name, score: r.score, cut: r.cut, award: r.award,
  }));
}

/** The reveal's opening state: shortlist order with Round 1 scores, marked against the finalist cut. */
function shortlistRows(category: LeaderCategory): LedgerRow[] {
  return [...category.rows].sort((a, b) => a.previousRank - b.previousRank).map((r) => ({
    key: String(r.entryNumber), rank: r.previousRank, entryNumber: r.entryNumber, title: r.title, meta: r.studioName,
    category: category.name, score: r.previousScore, cut: r.previousRank <= category.cut ? "above" : "below", award: null,
  }));
}

function CategorySection({ category, revealing, announce }: { category: LeaderCategory; revealing: boolean; announce: (line: string) => void }) {
  const ledger = useRef<Ledger | null>(null);
  const headingId = `category-${category.id}`;
  return (
    <section class="board-section" aria-labelledby={headingId}>
      <h2 id={headingId} class="category-header">{category.name}</h2>
      {category.state === "embargoed" ? <p class="board-section__note">Reveals at {category.revealsLabel}</p> : null}
      {category.state === "pending" ? <p class="board-section__note">No results yet.</p> : null}
      {category.state === "revealed" ? (
        <>
          <div class="board-section__tools">
            <button type="button" class="button button--quiet"
              onClick={() => void ledger.current?.replay(shortlistRows(category), finalRows(category))}>
              Replay reveal<span class="sr-only"> for {category.name}</span>
            </button>
          </div>
          <StandingsTable label={`${category.name} standings`} cutLabel="Finalist cut" cutCount={category.cut}
            rows={finalRows(category)} ledger={ledger} announce={announce} revealFrom={revealing ? shortlistRows(category) : null} />
        </>
      ) : null}
    </section>
  );
}

export function Leaderboard() {
  const { path } = useDesk();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState("");
  const [revealing, setRevealing] = useState<Set<string>>(new Set());
  const status = useRef<HTMLParagraphElement>(null);
  const announce = (line: string) => {
    if (status.current) status.current.textContent = line;
  };

  const load = async (programId: string | null) => {
    const [list, next] = await Promise.all([get<{ programs: Program[] }>("/api/programs"),
      get<Board>(`/api/public/leaderboard${programId ? `?programId=${encodeURIComponent(programId)}` : ""}`)]);
    if (list.ok) setPrograms(list.data.programs);
    if (next.ok) {
      setRevealing(new Set());
      setBoard(next.data);
    } else setFailed(next.message);
  };
  useEffect(() => {
    void load(null);
  }, [path]);

  useEffect(() => {
    if (!board) return;
    const timer = setInterval(async () => {
      const next = await get<Board>(`/api/public/leaderboard?programId=${encodeURIComponent(board.program.id)}`);
      if (!next.ok) return;
      const newly = next.data.categories.filter((c) => c.state === "revealed"
        && board.categories.find((old) => old.id === c.id)?.state !== "revealed").map((c) => c.id);
      if (newly.length || next.data.categories.some((c, i) => c.state !== board.categories[i]?.state)) {
        setRevealing(new Set(newly));
        setBoard(next.data);
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [board]);

  const embargoed = (board?.categories ?? []).filter((c) => c.state === "embargoed" && c.revealsAt)
    .sort((a, b) => Date.parse(a.revealsAt ?? "") - Date.parse(b.revealsAt ?? ""));
  useBand(board ? { name: board.program.name, target: embargoed[0]?.revealsAt ?? null, fallback: "Results published" } : null);

  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Leaderboard</p>
        <h1 class="page-title">{board?.program.name ?? "Results"}</h1>
        {programs.length && board ? (
          <div class="page-head__tools">
            <SelectField id="board-program" label="Program" value={board.program.name}
              options={programs.map((p) => ({ value: p.name, label: `${p.name} (${p.year})` }))}
              onValue={(name) => void load(programs.find((p) => p.name === name)?.id ?? null)} />
          </div>
        ) : null}
      </header>
      <p ref={status} role="status" aria-live="polite" aria-label="Standings updates" class="standings-status" />
      {failed ? <p class="notice">{failed}</p> : null}
      {board ? board.categories.map((category) => (
        <CategorySection key={`${category.id}:${category.state}`} category={category} revealing={revealing.has(category.id)} announce={announce} />
      )) : <p class="loading">Loading…</p>}
    </div>
  );
}

const AWARD_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: AWARD_LABEL.winner, value: "winner" },
  { label: AWARD_LABEL.finalist, value: "finalist" },
  { label: AWARD_LABEL.honourable_mention, value: "honourable_mention" },
];

export function Gallery() {
  useBand({ name: "Gallery", target: null });
  const [all, setAll] = useState<GalleryItem[] | null>(null);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [year, setYear] = useState("All");
  const [category, setCategory] = useState("All");
  const [award, setAward] = useState("All");
  useEffect(() => {
    void get<{ items: GalleryItem[] }>("/api/public/gallery").then((r) => {
      if (r.ok) {
        setAll(r.data.items);
        setItems(r.data.items);
      }
    });
  }, []);
  const filter = async (next: { year: string; category: string; award: string }) => {
    setYear(next.year);
    setCategory(next.category);
    setAward(next.award);
    const query = new URLSearchParams();
    if (next.year !== "All") query.set("year", next.year);
    if (next.category !== "All") query.set("category", next.category);
    const level = AWARD_FILTERS.find((a) => a.label === next.award)?.value;
    if (level) query.set("award", level);
    const r = await get<{ items: GalleryItem[] }>(`/api/public/gallery?${query}`);
    if (r.ok) setItems(r.data.items);
  };
  const years = [...new Set((all ?? []).map((i) => String(i.year)))];
  const categories = [...new Set((all ?? []).map((i) => i.category))].sort((a, b) => a.localeCompare(b));
  const current = { year, category, award };
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">Past winners</p>
        <h1 class="page-title">Gallery</h1>
      </header>
      <div class="filters">
        <SelectField id="gallery-year" label="Year" value={year} options={["All", ...years].map((v) => ({ value: v, label: v }))}
          onValue={(v) => void filter({ ...current, year: v })} />
        <SelectField id="gallery-category" label="Category" value={category}
          options={["All", ...categories].map((v) => ({ value: v, label: v }))} onValue={(v) => void filter({ ...current, category: v })} />
        <SelectField id="gallery-award" label="Award level" value={award}
          options={AWARD_FILTERS.map((a) => ({ value: a.label, label: a.label }))} onValue={(v) => void filter({ ...current, award: v })} />
      </div>
      {items === null ? <p class="loading">Loading…</p> : (
        <ul class="gallery" aria-label="Winners">
          {items.map((item) => (
            <li key={`${item.programName}-${item.entryNumber}`}>
              <article class="card" aria-labelledby={`card-${item.programName}-${item.entryNumber}`.replace(/\W+/g, "-")}>
                <div class="card__media">
                  {item.images[0] ? <img src={item.images[0]} alt={`${item.title} by ${item.studioName}`} width={1280} height={800} loading="lazy" /> : null}
                </div>
                <div class="card__body">
                  <h2 id={`card-${item.programName}-${item.entryNumber}`.replace(/\W+/g, "-")} class="card__title">{item.title}</h2>
                  <p class="card__studio">{item.studioName}</p>
                  <p class="card__meta">{item.year} · {item.category}</p>
                  <p class="card__foot"><Marker kind={item.award} /><span class="num card__score">{item.score ?? "—"}</span></p>
                </div>
              </article>
            </li>
          ))}
          {items.length === 0 ? <li class="gallery__empty">No winners match these filters.</li> : null}
        </ul>
      )}
    </div>
  );
}
