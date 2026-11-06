// The board index (/boards, with the mouse-only cover preview) and the board listing (/boards/<board>),
// whose every choice lives in the address so Back and Forward restore each step.

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { api } from "../api.js";
import { Link, definePage, navigate, useLocation } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Portrait } from "../ui/portrait.js";
import { RadioGroup, Select } from "../ui/fields.js";
import { Dialog } from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { PHONE, useMediaQuery } from "../ui/media.js";
import { addToTray, removeFromTray, useTray } from "../tray.js";
import { compactReach } from "../../shared/format.js";
import { heightIn, type Unit } from "../../shared/measure.js";
import { BOARDS, CITY, DEFAULT_QUERY, boardBySlug, boardHref, type BoardInfo, type Card, type Listing } from "../public-data.js";

function BoardNav({ current }: { current: string | null }) {
  return (
    <nav aria-label="Boards" className="board-nav">
      {BOARDS.map((info) => (
        <Link key={info.slug} href={boardHref(info.slug)} aria-current={current === info.slug ? "page" : undefined}>
          {info.title}
        </Link>
      ))}
    </nav>
  );
}

interface BoardSummary {
  board: string;
  title: string;
  count: number;
  coverPhotoUrl: string | null;
}

function BoardsIndex() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    void api<{ boards: BoardSummary[] }>("GET", "/api/public/boards").then((result) => {
      if (result.ok) setBoards(result.data.boards);
    });
  }, []);

  const follow = (event: PointerEvent<HTMLAnchorElement>, url: string | null) => {
    if (event.pointerType !== "mouse" || !preview.current) return;
    setCover(url);
    preview.current.style.transform = `translate(${event.clientX + 24}px, ${event.clientY + 24}px)`;
    preview.current.classList.add("shown");
  };
  const hide = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") preview.current?.classList.remove("shown");
  };

  return (
    <>
      <BoardNav current={null} />
      <Heading lines={["Boards"]} />
      <p className="lede">Four boards of fashion and commercial models and content creators, represented from our Toronto and
        Vancouver offices. Open a board to browse portraits, measurements and reach.</p>
      <ul className="board-rows">
          {BOARDS.map((info) => {
            const summary = boards?.find((entry) => entry.board === info.board);
            return (
              <li key={info.slug}>
                <Link href={boardHref(info.slug)} className="board-row"
                  onPointerMove={(event) => follow(event, summary?.coverPhotoUrl ?? null)} onPointerLeave={hide}>
                  <span className="board-row-title display-l">{info.title}</span>
                  <span className="board-row-count num">{summary ? `${summary.count} talent` : "Counting…"}</span>
                </Link>
              </li>
            );
          })}
      </ul>
      <div ref={preview} className="board-preview" aria-hidden="true">
        {cover ? <img src={cover} alt="" /> : <Portrait src={null} alt="" name="" />}
      </div>
    </>
  );
}

type Choices = typeof DEFAULT_QUERY;

const OFFICE_CHOICES = [
  { value: "all", label: "All offices" },
  { value: "toronto", label: "Toronto" },
  { value: "vancouver", label: "Vancouver" },
];
const SORT_CHOICES = [
  { value: "name", label: "Name" },
  { value: "height", label: "Height" },
  { value: "reach", label: "Reach" },
];
const UNIT_CHOICES = [
  { value: "cm", label: "cm" },
  { value: "ft_in", label: "ft and in" },
];

function readChoices(query: URLSearchParams): Choices | null {
  const office = query.get("office");
  const sort = query.get("sort");
  const unit = query.get("unit");
  const page = query.get("page");
  const q = query.get("q");
  if (!office || !OFFICE_CHOICES.some((c) => c.value === office) || !sort || !SORT_CHOICES.some((c) => c.value === sort)
    || !unit || !UNIT_CHOICES.some((c) => c.value === unit) || !page || !/^[1-9]\d*$/.test(page) || q === null) {
    return null;
  }
  return { office, q, sort, unit, page };
}

function listingPath(board: BoardInfo, choices: Choices): string {
  const params = new URLSearchParams({ board: board.board, sort: choices.sort, page: choices.page });
  if (choices.office !== "all") params.set("office", choices.office);
  if (choices.q) params.set("q", choices.q);
  return `/api/public/talent?${params.toString()}`;
}

export function TrayButton({ card, portrait }: { card: Card; portrait: () => HTMLElement | null }) {
  const tray = useTray();
  const held = tray.some((item) => item.slug === card.slug);
  return held ? (
    <Button variant="quiet" onClick={() => removeFromTray(card.slug)}>Remove from tray</Button>
  ) : (
    <Button variant="quiet" onClick={() => addToTray({ slug: card.slug, displayName: card.displayName,
      photoUrl: card.coverPhotoUrl }, portrait())}>Add to tray</Button>
  );
}

function BoardCard({ card, unit }: { card: Card; unit: Unit }) {
  const frame = useRef<HTMLDivElement>(null);
  const id = `card-${card.slug}`;
  return (
    <article className="talent-card" aria-labelledby={id}>
      <div ref={frame}>
        <Portrait src={card.coverPhotoUrl} alt={`${card.displayName}, portrait`} name={card.displayName} />
      </div>
      <h2 id={id} className="talent-card-name">
        <Link href={`/talent/${card.slug}?unit=${unit}`}>{card.displayName}</Link>
      </h2>
      <dl className="facts">
        <div><dt>Office</dt><dd>{CITY[card.office]}</dd></div>
        <div><dt>Height</dt><dd className="num">{card.measurements.heightCm === null ? "Not listed" : heightIn(card.measurements.heightCm, unit)}</dd></div>
        <div><dt>Reach</dt><dd className="num">{compactReach(card.reach.total)}</dd></div>
      </dl>
      <TrayButton card={card} portrait={() => frame.current?.querySelector<HTMLElement>(".portrait-frame") ?? null} />
    </article>
  );
}

function Controls({ choices, onChange, idPrefix }: {
  choices: Choices;
  onChange: (next: Partial<Choices>) => void;
  idPrefix: string;
}) {
  return (
    <>
      <RadioGroup id={`${idPrefix}-office`} label="Office" name={`${idPrefix}-office`} choices={OFFICE_CHOICES}
        value={choices.office} onChange={(office) => onChange({ office })} />
      <Select id={`${idPrefix}-sort`} label="Sort by" choices={SORT_CHOICES} value={choices.sort}
        onChange={(sort) => onChange({ sort })} />
      <RadioGroup id={`${idPrefix}-unit`} label="Units" name={`${idPrefix}-unit`} choices={UNIT_CHOICES}
        value={choices.unit} onChange={(unit) => onChange({ unit })} />
    </>
  );
}

function SearchForm({ value, onSearch, id }: { value: string; onSearch: (q: string) => void; id: string }) {
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(typed.trim());
  };
  return (
    <form role="search" className="field search-field" onSubmit={submit} noValidate>
      <label htmlFor={id}>Search talent</label>
      <input id={id} type="search" className="input" value={typed} onChange={(e) => setTyped(e.target.value)}
        autoComplete="off" />
    </form>
  );
}

function FilterSheet({ board, choices, onClose }: { board: BoardInfo; choices: Choices; onClose: () => void }) {
  const [pending, setPending] = useState<Choices>({ ...choices, page: "1" });
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void api<Listing>("GET", listingPath(board, pending)).then((result) => {
      if (live && result.ok) setCount(result.data.total);
    });
    return () => {
      live = false;
    };
  }, [board, pending]);
  return (
    <Dialog title="Filters" sheet onClose={onClose} actions={
      <Button disabled={count === null} onClick={() => {
        onClose();
        navigate(boardHref(board.slug, { ...pending, page: "1" }));
      }}>{count === null ? "Counting talent…" : `Show ${count} talent`}</Button>
    }>
      <SearchForm id="sheet-search" value={pending.q} onSearch={(q) => setPending({ ...pending, q })} />
      <Controls idPrefix="sheet" choices={pending} onChange={(next) => setPending({ ...pending, ...next })} />
    </Dialog>
  );
}

function BoardListing({ slug }: { slug: string }) {
  const board = boardBySlug(slug);
  const { query } = useLocation();
  const choices = readChoices(query);
  const phone = useMediaQuery(PHONE);
  const [listing, setListing] = useState<Listing | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const key = choices ? listingPath(board ?? BOARDS[0], choices) : "";

  useEffect(() => {
    if (board && !choices) navigate(boardHref(board.slug, Object.fromEntries(
      Object.keys(DEFAULT_QUERY).flatMap((name) => (query.get(name) ? [[name, query.get(name) ?? ""]] : [])))), { replace: true });
  }, [board, choices, query]);

  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    void api<Listing>("GET", key).then((result) => {
      if (!live) return;
      if (result.ok) {
        setListing(result.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [key]);

  if (!board || !choices) return <p className="muted">Loading the board…</p>;
  const change = (next: Partial<Choices>) => navigate(boardHref(board.slug, { ...choices, ...next, page: next.page ?? "1" }));
  const page = Number(choices.page);
  const unit = choices.unit === "ft_in" ? "ft_in" : "cm";

  return (
    <>
      <BoardNav current={board.slug} />
      <Heading lines={[board.title]} />
      {phone ? (
        <div className="listing-controls phone">
          <Button variant="quiet" onClick={() => setSheet(true)}>Filters</Button>
        </div>
      ) : (
        <div className="listing-controls">
          <SearchForm id="board-search" value={choices.q} onSearch={(q) => change({ q })} />
          <Controls idPrefix="board" choices={choices} onChange={change} />
        </div>
      )}
      {sheet ? <FilterSheet board={board} choices={choices} onClose={() => setSheet(false)} /> : null}
      {failed ? <p className="muted">The board could not be loaded. Reload the page to try again.</p> : null}
      {listing === null ? <p className="muted">Loading talent…</p> : (
        <>
          <p className="listing-total muted num">
            {listing.total === 1 ? "1 talent" : `${listing.total} talent`}{choices.q ? ` matching “${choices.q}”` : ""}
          </p>
          {listing.talent.length ? (
            <div className="card-grid">
              {listing.talent.map((card) => <BoardCard key={card.slug} card={card} unit={unit} />)}
            </div>
          ) : (
            <section className="panel">
              <h2>No talent match these choices</h2>
              <p className="muted">Try another office or clear the search.</p>
            </section>
          )}
          <nav aria-label="Pages" className="pager">
            {page > 1 ? <Link href={boardHref(board.slug, { ...choices, page: String(page - 1) })}>Previous page</Link>
              : <span className="pager-off" aria-hidden="true">Previous page</span>}
            <span className="num">Page {Math.min(page, Math.max(1, listing.totalPages))} of {Math.max(1, listing.totalPages)}</span>
            {page < listing.totalPages ? <Link href={boardHref(board.slug, { ...choices, page: String(page + 1) })}>Next page</Link>
              : <span className="pager-off" aria-hidden="true">Next page</span>}
          </nav>
        </>
      )}
    </>
  );
}

definePage({ pattern: "/", kind: "public", render: () => <Redirect to="/boards" /> });
definePage({ pattern: "/boards", kind: "public", render: () => <BoardsIndex /> });
definePage({ pattern: /^\/boards\/(women|men|creators|new-faces)$/, kind: "public",
  render: (match) => <BoardListing slug={match.params["0"]} /> });

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
