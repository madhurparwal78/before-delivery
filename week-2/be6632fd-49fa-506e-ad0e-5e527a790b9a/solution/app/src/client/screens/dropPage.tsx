// A public drop page (brief: Public screens → `/drops/<slug>`; Interactions → Carousel, Wait states).
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type FormEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { marketTime, position } from "../../shared/format";
import { CITY, MARKETS, type Market } from "../../shared/time";
import { api } from "../api";
import { Link } from "../router";
import { Button, Field, Loading, PageTitle, Problems, SelectField, StatusMark, StatusRegion, type StatusWord, refusalMessage, useMessage, useProblems } from "../ui";
import { NotFound } from "./access";

interface PublicDrop {
  slug: string;
  name: string;
  brand: string;
  type: "simultaneous" | "rolling";
  status: "upcoming" | "live" | "sold_out";
  palette: string[];
  storyHtml: string;
  looks: Array<{ id: string; position: number; title: string; altText: string; imageUrl: string; width: number; height: number }>;
  markets: Array<{ market: Market; city: string; goLiveAt: string | null; status: "upcoming" | "live" | "sold_out"; piecesLeft: number }>;
}

function Carousel({ looks }: { looks: PublicDrop["looks"] }): JSX.Element {
  const [index, setIndex] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const total = looks.length;
  const go = (delta: number): void => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(total - 1, 0)));
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "touch") start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
  };
  // A tap right after a swipe can lose the browser's synthesized click, so a touch steps on its own pointerup and the
  // click that may follow it is skipped; mouse, pen and keyboard step on click.
  const tapped = useRef(false);
  const stepper = (delta: number) => ({
    onPointerDown: () => (tapped.current = false),
    onPointerUp: (e: PointerEvent<HTMLButtonElement>): void => {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (e.pointerType !== "touch" || !hit || !e.currentTarget.contains(hit) || e.currentTarget.disabled) return;
      tapped.current = true;
      go(delta);
    },
    onClick: (e: MouseEvent<HTMLButtonElement>): void => {
      const skip = tapped.current && e.detail > 0;
      tapped.current = false;
      if (!skip) go(delta);
    },
  });
  return (
    <section className="carousel" aria-label="Look carousel" role="region">
      <div className="carousel-viewport" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (start.current = null)}>
        <ul className="carousel-track" style={{ transform: `translateX(${-index * 100}%)` }}>
          {looks.map((look, i) => (
            <li key={look.id} className="carousel-slide" aria-hidden={i !== index}>
              <img src={look.imageUrl} alt={look.altText} width={look.width} height={look.height} draggable={false} />
              <p className="carousel-caption">{look.title}</p>
            </li>
          ))}
        </ul>
      </div>
      <div className="carousel-controls">
        <button type="button" className="btn btn-secondary icon-btn" {...stepper(-1)} disabled={index <= 0}>
          <ChevronLeft size={18} aria-hidden="true" focusable="false" />
          <span>Previous look</span>
        </button>
        <div role="status" aria-label="Look position" className="mono look-position">
          {total ? position(index + 1, total) : position(0, 0)}
        </div>
        <button type="button" className="btn btn-secondary icon-btn" {...stepper(1)} disabled={index >= total - 1}>
          <span>Next look</span>
          <ChevronRight size={18} aria-hidden="true" focusable="false" />
        </button>
      </div>
    </section>
  );
}

function ClaimForm({ drop, onAnswer }: { drop: PublicDrop; onAnswer: () => void }): JSX.Element {
  const open = drop.markets.filter((m) => m.status === "live" && m.piecesLeft > 0);
  const [market, setMarket] = useState<string>(open[0]?.market ?? "copenhagen");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const key = useRef<string | null>(null);
  const p = useProblems([
    { path: "market", id: "claim-market", label: "Market" },
    { path: "name", id: "claim-name", label: "Name" },
    { path: "email", id: "claim-email", label: "Email" },
  ]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Claiming…");
    key.current ??= crypto.randomUUID();
    const body = { market, name, email };
    const r = await api<{ claim: { reference: string } }>("POST", `/api/public/drops/${drop.slug}/claims`, body, { "Idempotency-Key": key.current });
    setPending(false);
    if (r.ok || r.code !== "unreachable") key.current = null;
    onAnswer();
    if (r.ok) {
      p.clear();
      setMessage(`Claimed. Your reference is ${r.data.claim.reference}.`);
      return;
    }
    if (r.status === 422) p.show(r.fields);
    setMessage(refusalMessage(r));
  };
  return (
    <form className="panel claim-form" aria-label="Claim a piece" onSubmit={(e) => void submit(e)} noValidate>
      <h2>Claim a piece</h2>
      <Problems problems={p.problems} regionRef={p.regionRef} />
      <SelectField id="claim-market" label="Market" value={market} onChange={setMarket} options={MARKETS.map((m): [string, string] => [m, CITY[m]])} error={p.errors.market} />
      <Field id="claim-name" label="Name" value={name} onChange={setName} error={p.errors.name} autoComplete="name" />
      <Field id="claim-email" label="Email" type="email" value={email} onChange={setEmail} error={p.errors.email} autoComplete="email" />
      <Button type="submit" variant="primary" pending={pending} pendingText="Claiming…">
        Claim a piece
      </Button>
      <StatusRegion name="Claim status" message={message} />
    </form>
  );
}

function WaitlistForm({ drop }: { drop: PublicDrop }): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [market, setMarket] = useState<string>("copenhagen");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  const p = useProblems([
    { path: "name", id: "join-name", label: "Name" },
    { path: "email", id: "join-email", label: "Email" },
    { path: "market", id: "join-market", label: "Market" },
    { path: "consent", id: "join-consent", label: "I agree to receive drop emails" },
  ]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("Joining…");
    const r = await api<{ status: string }>("POST", `/api/public/drops/${drop.slug}/waitlist`, { market, name, email, consent });
    setPending(false);
    if (r.ok) {
      p.clear();
      setMessage("Check your inbox. If this address can join, a confirmation link is on its way.");
      return;
    }
    if (r.status === 422) p.show(r.fields);
    if (r.status === 429) {
      setMessage(`Too many sign-ups from this connection. Try again in ${String(r.extra.retryAfterSeconds)} seconds.`);
      return;
    }
    setMessage(refusalMessage(r));
  };
  return (
    <form id="waitlist-form" className="panel waitlist-form" aria-label="Join the waitlist" onSubmit={(e) => void submit(e)} noValidate>
      <h2>Join the waitlist</h2>
      <p className="muted">Get a hold email when a piece is offered to you, in join order.</p>
      <Problems problems={p.problems} regionRef={p.regionRef} />
      <Field id="join-name" label="Name" value={name} onChange={setName} error={p.errors.name} autoComplete="name" />
      <Field id="join-email" label="Email" type="email" value={email} onChange={setEmail} error={p.errors.email} autoComplete="email" />
      <SelectField id="join-market" label="Market" value={market} onChange={setMarket} options={MARKETS.map((m): [string, string] => [m, CITY[m]])} error={p.errors.market} />
      <div className={`check${p.errors.consent ? " has-error" : ""}`}>
        <input id="join-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby={p.errors.consent ? "join-consent-error" : undefined} aria-invalid={p.errors.consent ? true : undefined} />
        <label htmlFor="join-consent">I agree to receive drop emails</label>
        {p.errors.consent ? (
          <p className="field-error" id="join-consent-error">
            {p.errors.consent}
          </p>
        ) : null}
      </div>
      <div className="sticky-bar join-bar" data-sticky-bar>
        <Button type="submit" variant="primary" pending={pending} pendingText="Joining…">
          Join waitlist
        </Button>
      </div>
      <StatusRegion name="Waitlist status" message={message} />
    </form>
  );
}

function WithdrawnPage(): JSX.Element {
  return (
    <section className="night-section withdrawn">
      <div className="night-inner">
        <PageTitle className="display">This drop was withdrawn</PageTitle>
        <p className="withdrawn-word">
          <StatusMark status="withdrawn" />
        </p>
        <p>
          <Link to="/">Back to the drop calendar</Link>
        </p>
      </div>
    </section>
  );
}

export function DropPage({ slug }: { slug: string }): JSX.Element {
  const [drop, setDrop] = useState<PublicDrop | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "withdrawn" | "missing">("loading");
  const load = useCallback(async () => {
    const r = await api<PublicDrop>("GET", `/api/public/drops/${encodeURIComponent(slug)}`);
    if (r.ok) {
      setDrop(r.data);
      setState("ok");
    } else setState(r.status === 410 ? "withdrawn" : r.status === 404 ? "missing" : "loading");
  }, [slug]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  if (state === "withdrawn") return <WithdrawnPage />;
  if (state === "missing") return <NotFound />;
  if (!drop) return <Loading />;
  const claimable = drop.markets.some((m) => m.status === "live" && m.piecesLeft > 0);
  return (
    <div className="drop-page">
      <section className="night-section drop-hero">
        <div className="night-inner">
          <p className="eyebrow">
            {drop.brand} · {drop.type === "rolling" ? "Rolling go-live" : "Simultaneous go-live"}
          </p>
          <PageTitle className="display">{drop.name}</PageTitle>
          <p className="hero-status">
            <StatusMark status={drop.status as StatusWord} />
          </p>
          <div className="table-scroll" tabIndex={0}>
            <table aria-label="Market availability" className="ruled night-table cards-on-phone">
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col">Opens</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Pieces left</th>
                </tr>
              </thead>
              <tbody>
                {drop.markets.map((m) => (
                  <tr key={m.market}>
                    <th scope="row">{m.city}</th>
                    <td className="mono" data-label="Opens">{m.goLiveAt ? marketTime(Date.parse(m.goLiveAt), m.market) : "—"}</td>
                    <td data-label="Status">
                      <StatusMark status={m.status} />
                    </td>
                    <td className="mono num" data-label="Pieces left">{m.piecesLeft}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <div className="drop-body">
        <Carousel looks={drop.looks} />
        <div className="drop-aside">
          <section className="panel story-panel" aria-labelledby="story-heading">
            <h2 id="story-heading">The story</h2>
            <article aria-label="Story" className="story" dangerouslySetInnerHTML={{ __html: drop.storyHtml || "<p>The story of this drop is coming soon.</p>" }} />
          </section>
          <div className="drop-forms">
            {claimable ? <ClaimForm drop={drop} onAnswer={() => void load()} /> : null}
            <WaitlistForm drop={drop} />
          </div>
        </div>
      </div>
    </div>
  );
}
