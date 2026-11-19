// Home, catalogue and lot pages: the public saleroom.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Portrait } from "./portraits";
import {
  ApiError, HistoryRow, Lot, Sale, UNEXPECTED, announce, api, boot, commas, errorText, euros, go, hasRole, isRunning,
  reducedMotion, rotterdam, stamp,
} from "./lib";
import { Frame, live } from "./live";
import { EmptyState, Modal, Numeral, Shell, TimeLeft, captionFor, useSocketState, useTick } from "./ui";

interface CatalogueData {
  sale: Sale;
  lots: Lot[];
  seq: number;
}

/** catalogueOrder keeps running lots first by close, then closed lots by number, as the server does. */
function catalogueOrder(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const ra = isRunning(a), rb = isRunning(b);
    if (ra !== rb) return ra ? -1 : 1;
    if (ra && a.closes_at !== b.closes_at) return (a.closes_at ?? "") < (b.closes_at ?? "") ? -1 : 1;
    return (a.lot_number ?? 0) - (b.lot_number ?? 0);
  });
}

async function loadCatalogue(saleId: string | null): Promise<CatalogueData | null> {
  try {
    let id = saleId;
    if (!id) id = (await api<{ sale: Sale }>("/api/sales/current")).sale.id;
    const raw = await api<{ sale: Sale; lots: Lot[]; seq: number }>(`/api/sales/${id}/catalogue`);
    return { sale: raw.sale, lots: catalogueOrder(raw.lots.map(stamp)), seq: raw.seq };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** useCatalogue loads a sale's lots, opens the page's socket from the response's seq and applies lot frames. */
function useCatalogue(saleId: string | null): { data: CatalogueData | null | undefined; failed: boolean } {
  const [data, setData] = useState<CatalogueData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const current = useRef<CatalogueData | null>(null);
  useLayoutEffect(() => {
    loadCatalogue(saleId).then(
      (loaded) => {
        current.current = loaded;
        live.start(loaded ? loaded.seq : null);
        setData(loaded);
      },
      () => {
        live.start(null);
        setFailed(true);
      },
    );
    return live.onFrame((f: Frame) => {
      const cur = current.current;
      if (f.type !== "lot_changed" || !cur) return;
      if (f.lot.sale_id !== cur.sale.id) return;
      const next = stamp(f.lot);
      const lots = cur.lots.some((l) => l.id === next.id)
        ? cur.lots.map((l) => (l.id === next.id && next.server_now >= l.server_now ? next : l))
        : [...cur.lots, next];
      current.current = { ...cur, lots: catalogueOrder(lots) };
      setData(current.current);
    });
  }, []);
  return { data, failed };
}

/** Tile is one lot: the link carries the brief's name and covers the whole tile, and the caption beside it stays
 * ordinary text, so the link's name never has to repeat the changing caption. */
function Tile({ lot, tab, onFocus, onHover }: { lot: Lot; tab?: boolean; onFocus?: () => void; onHover?: () => void }) {
  return (
    <div class="tile" onMouseEnter={onHover}>
      <a
        class="tile-link"
        href={`/lots/${lot.id}`}
        data-lot={lot.id}
        aria-label={`Lot ${lot.lot_number}, ${lot.title}`}
        tabIndex={tab === undefined ? undefined : tab ? 0 : -1}
        onFocus={onFocus}
      >
        <Portrait kind={lot.portrait} />
      </a>
      <span class="caption">{captionFor(lot)}</span>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div class="skeleton" aria-busy="true" aria-label={label}>
      <div class="skeleton-block" />
      <div class="skeleton-block" />
    </div>
  );
}

function FailedNotice() {
  return <p class="form-message">{UNEXPECTED}</p>;
}

export function HomePage() {
  const { data, failed } = useCatalogue(null);
  useTick();
  let body;
  if (failed) body = <FailedNotice />;
  else if (data === undefined) body = <Loading label="Loading the sale" />;
  else if (data === null)
    body = (
      <EmptyState line="NO SALE THIS WEEK">The next catalogue opens soon.</EmptyState>
    );
  else {
    const poster = [...data.lots].sort((a, b) => (a.lot_number ?? 0) - (b.lot_number ?? 0)).slice(0, 6);
    const grid = data.lots.slice(0, 12);
    body = (
      <>
        <div class="poster">
          <div class="title-pin">
            <h1 class="home-title">{data.sale.title}</h1>
          </div>
          <div class="flow">
            {poster.map((lot) => (
              <figure class="poster-lot" key={lot.id}>
                <Portrait kind={lot.portrait} label={`Lot ${lot.lot_number}, ${lot.title}`} />
                <figcaption>{`Lot ${lot.lot_number} · Estimate ${euros(lot.estimate_low)}–${commas(lot.estimate_high ?? 0)}`}</figcaption>
              </figure>
            ))}
            <div class="poster-foot">
              <p>One sale a week. Closing one minute apart, from Thursday 20:00 Rotterdam time.</p>
              <a class="gold-btn" href="/catalogue">
                View the catalogue
              </a>
            </div>
          </div>
        </div>
        <section class="mini-grid">
          {grid.map((lot) => (
            <Tile lot={lot} key={lot.id} />
          ))}
        </section>
      </>
    );
  }
  return (
    <Shell>
      <main class="home">{body}</main>
    </Shell>
  );
}

export function CataloguePage({ saleId }: { saleId: string | null }) {
  const { data, failed } = useCatalogue(saleId);
  useTick();
  const [stop, setStop] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const keep = useRef<string | null>(null);
  keep.current = document.activeElement instanceof HTMLElement ? (document.activeElement.dataset.lot ?? null) : null;
  useLayoutEffect(() => {
    const id = keep.current;
    if (id && grid.current && !(document.activeElement instanceof HTMLElement && document.activeElement.dataset.lot === id)) {
      grid.current.querySelector<HTMLElement>(`[data-lot="${id}"]`)?.focus({ preventScroll: true });
    }
  });

  if (failed) return <Shell><main class="catalogue-empty"><FailedNotice /></main></Shell>;
  if (data === undefined) return <Shell><main class="catalogue-empty"><Loading label="Loading the catalogue" /></main></Shell>;
  if (data === null)
    return (
      <Shell>
        <main class="catalogue-empty">
          <EmptyState line="NO SALE THIS WEEK">The next catalogue opens soon.</EmptyState>
        </main>
      </Shell>
    );

  const lots = data.lots;
  const tabId = stop && lots.some((l) => l.id === stop) ? stop : (lots[0]?.id ?? null);
  const previewId = hovered ?? focused ?? tabId;
  const preview = lots.find((l) => l.id === previewId);

  const onKey = (e: KeyboardEvent) => {
    const links = [...(grid.current?.querySelectorAll<HTMLElement>("a[data-lot]") ?? [])];
    const index = links.findIndex((l) => l === document.activeElement);
    if (index < 0) return;
    const rowOf = (l: HTMLElement) => Math.round(l.getBoundingClientRect().top);
    const top = links[0] ? rowOf(links[0]) : 0;
    const columns = Math.max(1, links.filter((l) => rowOf(l) === top).length);
    const moves: Record<string, number> = {
      ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns, Home: 0, End: links.length - 1,
    };
    const target = moves[e.key];
    if (target === undefined) return;
    e.preventDefault();
    const link = links[target];
    if (!link) return;
    link.focus();
    (link.closest<HTMLElement>(".tile") ?? link).scrollIntoView({ block: "nearest" });
    setStop(link.dataset.lot ?? null);
  };

  return (
    <Shell>
      <main class="catalogue">
        <div class="cat-head">
          <h1 class="sale-title">{data.sale.title}</h1>
          <PosterSwap lot={preview ?? null} />
        </div>
        <div role="grid" aria-label="Catalogue" class="tiles" ref={grid} onKeyDown={onKey} onFocusOut={() => setFocused(null)}>
          {lots.map((lot) => (
            <div role="row" class="tile-row" key={lot.id}>
              <div role="gridcell">
                <Tile
                  lot={lot}
                  tab={lot.id === tabId}
                  onFocus={() => {
                    setStop(lot.id);
                    setFocused(lot.id);
                  }}
                  onHover={() => setHovered(lot.id)}
                />
              </div>
            </div>
          ))}
        </div>
      </main>
    </Shell>
  );
}

interface Layer {
  key: number;
  lot: Lot;
  leaving: boolean;
}

/** PosterSwap cross-fades the large portrait to the lot in focus (wide screens only). */
function PosterSwap({ lot }: { lot: Lot | null }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const counter = useRef(0);
  const lotId = lot?.id ?? null;
  useLayoutEffect(() => {
    if (!lot) return;
    setLayers((cur) => {
      if (cur.find((l) => !l.leaving)?.lot.id === lot.id) return cur;
      const entering: Layer = { key: ++counter.current, lot, leaving: false };
      if (reducedMotion()) return [entering];
      return [...cur.filter((l) => l.leaving).slice(-1), ...cur.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), entering];
    });
  }, [lotId]);
  return (
    <div class="swap-stage" aria-hidden="true">
      {layers.map((layer) => (
        <div
          class={layer.leaving ? "swap-layer leaving" : "swap-layer"}
          key={layer.key}
          onAnimationEnd={() => setLayers((cur) => cur.filter((l) => l.key !== layer.key || !l.leaving))}
        >
          <Portrait kind={layer.lot.portrait} />
        </div>
      ))}
    </div>
  );
}

// ---- lot page ----

interface LotData {
  lot: Lot;
  history: HistoryRow[];
  seq: number;
}

const NO_RESPONSE = "Your bid did not reach the saleroom. Try again — it will only count once.";

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Draft {
  type: "single" | "maximum";
  value: string;
}

function loadDraft(lotId: string): Draft {
  try {
    const raw = JSON.parse(localStorage.getItem(`gavelhouse:draft:${lotId}`) ?? "null") as Draft | null;
    if (raw && (raw.type === "single" || raw.type === "maximum") && typeof raw.value === "string") return raw;
  } catch {
    /* an unreadable draft is the same as none */
  }
  return { type: "single", value: "" };
}

function saveDraft(lotId: string, draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(`gavelhouse:draft:${lotId}`, JSON.stringify(draft));
    else localStorage.removeItem(`gavelhouse:draft:${lotId}`);
  } catch {
    /* storage may be unavailable; the draft then lives only on this page */
  }
}

interface FormProps {
  lot: Lot;
  open: boolean;
  placeRef: { current: HTMLButtonElement | null };
  applyLot: (lot: Lot) => void;
  reload: () => void;
  askConfirm: (text: string, yes: () => void) => void;
}

function BidForm({ lot, open, placeRef, applyLot, reload, askConfirm }: FormProps) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(lot.id));
  const [fieldError, setFieldError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const key = useRef<{ sig: string; key: string } | null>(null);
  const asking = lot.asking ?? lot.opening_bid ?? 0;
  const single = draft.type === "single";

  const update = (next: Draft) => {
    setDraft(next);
    saveDraft(lot.id, next);
  };

  const say = (text: string) => {
    setMessage(text);
    announce(text);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    if (pending || !open) return;
    setFieldError("");
    setMessage("");
    let amount = asking;
    if (!single) {
      const typed = draft.value.trim();
      const complain = (text: string) => {
        setFieldError(text);
        announce(text);
      };
      if (!/^\d{1,12}$/.test(typed) || Number(typed) < 1) return complain("Enter a whole number of euros.");
      amount = Number(typed);
      if (amount > 1000000) return complain("Enter no more than €1,000,000.");
      if (lot.i_lead && lot.my_max != null && amount <= lot.my_max) return complain(`Enter more than your maximum of ${euros(lot.my_max)}.`);
      if (!lot.i_lead && amount < asking) return complain(`Enter at least ${euros(asking)}.`);
    }
    const text = single ? `Bid ${euros(amount)} on lot ${lot.lot_number}?` : `Bid ${euros(amount)} as your maximum on lot ${lot.lot_number}?`;
    askConfirm(text, () => void send(single ? "single" : "maximum", amount));
  };

  const send = async (kind: "single" | "maximum", amount: number) => {
    const signature = `${kind}:${amount}`;
    if (key.current?.sig !== signature) key.current = { sig: signature, key: randomKey() };
    setPending(true);
    setMessage("Placing your bid…");
    try {
      const res = await api<{ lot: Lot }>(`/api/lots/${lot.id}/bids`, {
        method: "POST", body: { type: kind, max_amount: amount }, key: key.current.key, timeoutMs: 10000,
      });
      key.current = null;
      const next = stamp(res.lot);
      applyLot(next);
      saveDraft(lot.id, null);
      setDraft({ type: draft.type, value: "" });
      say(
        next.i_lead
          ? `Bid accepted. You lead at ${euros(next.price)}.`
          : `Bid accepted, but an earlier maximum is higher. Lot ${next.lot_number} now ${euros(next.price)}.`,
      );
      reload();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) {
        say(NO_RESPONSE);
      } else {
        key.current = null;
        const returned = e.body.lot as Lot | undefined;
        if (returned) applyLot(stamp(returned));
        if (e.code === "lot_closed") say(`Bidding on lot ${lot.lot_number} has closed.`);
        else if (e.code === "asking_changed") say(`The next bid is now ${euros(returned?.asking ?? asking)}. Check it and confirm again.`);
        else if (e.code === "registration_pending") say("Your spending limit is waiting for approval.");
        else if (e.fields.max_amount) {
          setMessage("");
          setFieldError(e.fields.max_amount);
          announce(e.fields.max_amount);
        } else say(UNEXPECTED);
      }
    } finally {
      setPending(false);
      placeRef.current?.focus();
    }
  };

  const shownValue = single ? euros(asking) : draft.value;
  const blocked = pending || !open;
  return (
    <form class="bid-form" onSubmit={submit} noValidate>
      <fieldset role="radiogroup" aria-label="Bid type">
        <label class="choice">
          <input type="radio" name="bid-type" checked={single} onChange={() => update({ ...draft, type: "single" })} />
          <span>Bid now</span>
        </label>
        <label class="choice">
          <input type="radio" name="bid-type" checked={!single} onChange={() => update({ ...draft, type: "maximum" })} />
          <span>Maximum bid</span>
        </label>
      </fieldset>
      <div class="field">
        <label for="your-maximum">Your maximum</label>
        <input
          id="your-maximum"
          type="text"
          inputMode="numeric"
          autocomplete="off"
          readOnly={single}
          value={shownValue}
          aria-invalid={fieldError ? "true" : undefined}
          aria-describedby={fieldError ? "maximum-error" : undefined}
          onInput={(e) => update({ ...draft, value: (e.currentTarget as HTMLInputElement).value })}
        />
        {fieldError && (
          <p class="field-error" id="maximum-error">
            {fieldError}
          </p>
        )}
      </div>
      <button type="submit" class="gold-btn" ref={(el) => {
          placeRef.current = el;
        }} aria-disabled={blocked ? "true" : undefined} aria-busy={pending ? "true" : undefined}>
        Place bid
      </button>
      {!open && <p class="hint">Connecting to the saleroom…</p>}
      {message && <p class="form-message">{message}</p>}
    </form>
  );
}

export function LotPage({ id }: { id: string }) {
  const [data, setData] = useState<LotData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [watchMessage, setWatchMessage] = useState("");
  const [confirmation, setConfirmation] = useState<{ text: string; yes: () => void } | null>(null);
  const [reserveFresh, setReserveFresh] = useState(false);
  const current = useRef<LotData | null>(null);
  const placeRef = useRef<HTMLButtonElement | null>(null);
  const socket = useSocketState();
  useTick();
  const bidder = hasRole("bidder");

  const apply = (lot: Lot, history?: HistoryRow[], seq?: number) => {
    const cur = current.current;
    if (cur && lot.server_now < cur.lot.server_now) return;
    const next: LotData = { lot, history: history ?? cur?.history ?? [], seq: seq ?? cur?.seq ?? 0 };
    if (cur) narrate(cur.lot, lot);
    if (cur && !cur.lot.reserve_met && lot.reserve_met) setReserveFresh(true);
    current.current = next;
    setData(next);
  };

  const reload = () => {
    api<{ lot: Lot; history: HistoryRow[]; seq: number }>(`/api/lots/${id}`).then(
      (res) => apply(stamp(res.lot), res.history),
      () => undefined,
    );
  };

  useLayoutEffect(() => {
    api<{ lot: Lot; history: HistoryRow[]; seq: number }>(`/api/lots/${id}`).then(
      (res) => {
        live.start(res.seq);
        const lot = stamp(res.lot);
        current.current = { lot, history: res.history, seq: res.seq };
        setData(current.current);
      },
      (e) => {
        live.start(null);
        if (e instanceof ApiError && e.status === 404) setData(null);
        else setFailed(true);
      },
    );
    return live.onFrame((f) => {
      if (f.type === "lot_changed" && f.lot.id === id) apply(stamp(f.lot), f.history, f.seq);
    });
  }, []);

  if (failed) return <Shell><main class="lot-page"><FailedNotice /></main></Shell>;
  if (data === undefined) return <Shell><main class="lot-page"><Loading label="Loading the lot" /></main></Shell>;
  if (data === null) return <Shell><main class="lot-page"><EmptyState line="NOT IN THIS SALE">That page is not in the saleroom.</EmptyState></main></Shell>;

  const { lot, history } = data;
  const running = isRunning(lot);
  const price = lot.price ?? lot.opening_bid ?? 0;
  const toggleWatch = async () => {
    if (!boot.me) return go(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
    const watching = !lot.watching;
    apply({ ...lot, watching, server_now: lot.server_now });
    try {
      await api(`/api/lots/${id}/watch`, { method: watching ? "PUT" : "DELETE" });
      const text = watching ? `Watching lot ${lot.lot_number}.` : `No longer watching lot ${lot.lot_number}.`;
      setWatchMessage(text);
      announce(text);
    } catch (e) {
      apply({ ...lot, watching: !watching });
      setWatchMessage(errorText(e));
    }
  };

  let leader = "No bids yet";
  if (lot.i_lead) leader = "You lead";
  else if (lot.leader_paddle != null) leader = `Paddle ${lot.leader_paddle} leads`;

  return (
    <Shell>
      <main class="lot-page">
        <section class="lot-board" aria-label="Lot board">
          <div class="lot-pin">
            <div class="lot-band">
              <Portrait kind={lot.portrait} />
              <div class="band-text">
                <h1 class="lot-title">{lot.title}</h1>
                <div class="price">
                  {lot.price == null && <p class="price-label">Opening bid</p>}
                  <Numeral value={price} />
                </div>
              </div>
            </div>
            <div class="lot-lines">
              {running && lot.asking != null && <p class="line next-bid">{`Next bid ${euros(lot.asking)}`}</p>}
              {lot.reserve_met && <ReserveLine fresh={reserveFresh} onShown={() => setReserveFresh(false)} />}
              <p class="line leader">{leader}</p>
              <TimeLeft lot={lot} />
              {(bidder || !boot.me) && (
                <>
                  <button type="button" class="outline-btn" aria-pressed={lot.watching ? "true" : "false"} onClick={toggleWatch}>
                    {lot.watching ? "Watching" : "Watch lot"}
                  </button>
                  {watchMessage && <p class="form-message">{watchMessage}</p>}
                </>
              )}
              {bidder && running && (
                <BidForm
                  lot={lot}
                  open={socket === "open"}
                  placeRef={placeRef}
                  applyLot={(next) => apply(next)}
                  reload={reload}
                  askConfirm={(text, yes) => setConfirmation({ text, yes })}
                />
              )}
            </div>
          </div>
          <div class="lot-detail">
            <div class="detail-portrait">
              <Portrait kind={lot.portrait} />
            </div>
            <dl class="facts">
              <div>
                <dt>Estimate</dt>
                <dd>{`${euros(lot.estimate_low)}–${commas(lot.estimate_high ?? 0)}`}</dd>
              </div>
              <div>
                <dt>Condition</dt>
                <dd>{lot.condition}</dd>
              </div>
              <div>
                <dt>Description</dt>
                <dd>{lot.description}</dd>
              </div>
            </dl>
            <table class="data-table" aria-label="Bid history">
              <thead>
                <tr>
                  <th scope="col">Paddle</th>
                  <th scope="col" class="num">Price</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr key={`${row.accepted_at}-${i}`}>
                    <td>{row.paddle}</td>
                    <td class="num">{euros(row.price_after)}</td>
                    <td>{rotterdam(row.accepted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Modal open={confirmation !== null} label="Confirm your bid" onClose={() => setConfirmation(null)} returnFocus={() => placeRef.current}>
        <form
          method="dialog"
          class="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            const yes = confirmation?.yes;
            setConfirmation(null);
            yes?.();
          }}
        >
          <p>{confirmation?.text}</p>
          <div class="dialog-actions">
            <button type="submit" class="gold-btn" data-autofocus>
              Confirm bid
            </button>
            <button type="button" class="outline-btn" onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </Shell>
  );
}

function ReserveLine({ fresh, onShown }: { fresh: boolean; onShown: () => void }) {
  const el = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (!fresh) return;
    onShown();
    if (!reducedMotion()) el.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  }, [fresh]);
  return (
    <p class="line reserve-met" ref={el}>
      Reserve met
    </p>
  );
}

/** narrate announces what changed on the lot on screen, once, unless a notice already said it. */
function narrate(before: Lot, after: Lot): void {
  const n = after.lot_number;
  if (isRunning(before) && !isRunning(after)) {
    if (live.takeCover(after.id, "close")) return;
    announce(after.status === "closed_sold" ? `Lot ${n} sold for ${euros(after.price)}.` : `Lot ${n} closed unsold.`);
    return;
  }
  const parts: string[] = [];
  const was = before.price ?? before.opening_bid;
  const now = after.price ?? after.opening_bid;
  if (was !== now && !live.takeCover(after.id, "price")) {
    parts.push(after.i_lead ? `Lot ${n} now ${euros(now)}, you lead.` : `Lot ${n} now ${euros(now)}.`);
  }
  if (!before.reserve_met && after.reserve_met) parts.push(`Reserve met on lot ${n}.`);
  if (parts.length) announce(parts.join(" "));
}
