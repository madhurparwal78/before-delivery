// Screens reached from emailed links: the held piece, the waitlist opt-in and the press preview.
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { COPY, holdExpired } from "../../shared/copy";
import { marketTime } from "../../shared/format";
import { CITY, type Market } from "../../shared/time";
import { api } from "../api";
import { Countdown, useNow } from "../countdown";
import { Button, Loading, PageTitle, StatusRegion, refusalMessage, useMessage } from "../ui";
import { NotFound } from "./access";

interface Hold {
  dropSlug: string;
  dropName: string;
  market: Market;
  city: string;
  status: "offered" | "claimed" | "expired" | "void";
  offeredAt: string;
  expiresAt: string;
}

export function ClaimPage({ token }: { token: string }): JSX.Element {
  const [hold, setHold] = useState<Hold | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [message, setMessage] = useMessage();
  const key = useRef<string | null>(null);
  const now = useNow();
  // Whether the hold is still open always comes from the server: the page re-checks it every 5 seconds.
  const shown = useRef<Hold["status"] | null>(null);
  useEffect(() => {
    const check = (): void => {
      void api<Hold>("GET", `/api/public/holds/${encodeURIComponent(token)}`).then((r) => {
        if (!r.ok) {
          if (r.status === 404) setMissing(true);
          return;
        }
        setHold(r.data);
        if (shown.current === r.data.status) return;
        shown.current = r.data.status;
        if (r.data.status === "expired" || r.data.status === "void") setMessage(holdExpired(marketTime(Date.parse(r.data.expiresAt))));
        if (r.data.status === "claimed") setMessage(COPY.holdClaimed);
      });
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [token, setMessage]);
  if (missing) return <NotFound />;
  if (!hold) return <Loading />;
  const ends = Date.parse(hold.expiresAt);
  const live = hold.status === "offered" && !claimed;
  const claim = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Claiming…");
    key.current ??= crypto.randomUUID();
    const r = await api<{ claim: { reference: string } }>("POST", `/api/public/drops/${hold.dropSlug}/claims`, { holdToken: token }, { "Idempotency-Key": key.current });
    setPending(false);
    if (r.ok || r.code !== "unreachable") key.current = null;
    if (r.ok) {
      shown.current = "claimed";
      setClaimed(true);
      setMessage(`Claimed. Your reference is ${r.data.claim.reference}.`);
    } else setMessage(refusalMessage(r));
  };
  return (
    <div className="link-page">
      <section className="panel link-panel">
        <p className="eyebrow">
          {hold.dropName} · {hold.city}
        </p>
        <PageTitle>Your held piece</PageTitle>
        <dl className="facts">
          <div>
            <dt>Drop</dt>
            <dd>{hold.dropName}</dd>
          </div>
          <div>
            <dt>Market</dt>
            <dd>{hold.city}</dd>
          </div>
          <div>
            <dt>Hold ends</dt>
            <dd className="mono">{marketTime(ends, hold.market)}</dd>
          </div>
        </dl>
        <p className="countdown-label" aria-hidden="true">
          Hold ends in
        </p>
        <Countdown label="Hold ends in" targetMs={ends} now={now} className="countdown-large" />
        <StatusRegion name="Claim status" message={message} />
      </section>
      <div className="sticky-bar always" data-sticky-bar>
        <Button variant="primary" pending={pending} pendingText="Claiming…" disabled={!live && !pending} onClick={() => void claim()}>
          Claim piece
        </Button>
      </div>
    </div>
  );
}

export function OptInPage({ token }: { token: string }): JSX.Element {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ dropName: string; city: string } | null>(null);
  const [message, setMessage] = useMessage();
  const confirmPlace = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Confirming…");
    const r = await api<{ dropName: string; market: Market }>("POST", "/api/public/waitlist/confirm", { token });
    setPending(false);
    if (r.ok) {
      const city = CITY[r.data.market];
      setDone({ dropName: r.data.dropName, city });
      setMessage(`You're on the waitlist for ${r.data.dropName} in ${city}.`);
    } else setMessage(refusalMessage(r));
  };
  return (
    <div className="link-page">
      <section className="panel link-panel">
        <PageTitle>Waitlist confirmation</PageTitle>
        {done ? (
          <dl className="facts">
            <div>
              <dt>Drop</dt>
              <dd>{done.dropName}</dd>
            </div>
            <div>
              <dt>Market</dt>
              <dd>{done.city}</dd>
            </div>
          </dl>
        ) : (
          <p>Confirm your place on the drop's waitlist. Holds are offered in join order once the drop goes live.</p>
        )}
        <Button variant="primary" pending={pending} pendingText="Confirming…" disabled={Boolean(done)} onClick={() => void confirmPlace()}>
          Confirm my place
        </Button>
        <StatusRegion name="Waitlist status" message={message} />
      </section>
    </div>
  );
}

interface PressPayload {
  brand: string;
  dropName: string;
  type: "simultaneous" | "rolling";
  embargoUntil: string | null;
  expiresAt: string;
  markets: Array<{ market: Market; city: string; goLiveAt: string | null }>;
  storyHtml: string;
  looks: Array<{ id: string; position: number; title: string; altText: string; imageUrl: string; width: number; height: number }>;
}

export function PressPage({ token }: { token: string }): JSX.Element {
  const [payload, setPayload] = useState<PressPayload | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useMessage();
  // An open press page follows its link's state on the server, asking again every 5 seconds.
  useEffect(() => {
    const check = (): void => {
      void api<PressPayload>("GET", `/api/press/${encodeURIComponent(token)}`).then((r) => {
        if (r.ok) setPayload(r.data);
        else if (r.status === 410) setDead(r.message);
        else if (r.status === 404) setMissing(true);
      });
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [token]);
  if (missing) return <NotFound />;
  if (dead) {
    return (
      <div className="link-page">
        <section className="panel link-panel">
          <PageTitle>This preview is no longer available</PageTitle>
          <p>{dead}</p>
        </section>
      </div>
    );
  }
  if (!payload) return <Loading />;
  const download = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setMessage("Preparing download…");
    let response: Response | null = null;
    try {
      response = await fetch(`/api/press/${encodeURIComponent(token)}/zip`);
    } catch {
      response = null;
    }
    setPending(false);
    if (!response?.ok) {
      setMessage(response?.status === 503 ? COPY.downloadsUnavailable : response?.status === 410 ? COPY.linkExpired : COPY.unreachable);
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.dropName.replace(/[^\w-]+/g, "-").toLowerCase()}-press.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMessage("Download ready.");
  };
  return (
    <div className="press-page">
      <section className="night-section press-hero">
        <div className="night-inner">
          <p className="eyebrow">{payload.brand} · Press preview</p>
          <PageTitle className="display">{`Press preview: ${payload.dropName}`}</PageTitle>
          <p className="mono embargo">{payload.embargoUntil ? `Embargoed until ${marketTime(Date.parse(payload.embargoUntil))}` : "Embargoed until the drop is scheduled"}</p>
          <p className="muted-on-night mono">This link expires {marketTime(Date.parse(payload.expiresAt))}.</p>
        </div>
      </section>
      <div className="press-body">
        <section className="panel">
          <h2>Market opening times</h2>
          <ul className="opening-list">
            {payload.markets.map((m) => (
              <li key={m.market}>
                <span>{m.city}</span>
                <span className="mono">{m.goLiveAt ? marketTime(Date.parse(m.goLiveAt), m.market) : "—"}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel story-panel" aria-labelledby="press-story">
          <h2 id="press-story">The story</h2>
          <article aria-label="Story" className="story" dangerouslySetInnerHTML={{ __html: payload.storyHtml || "<p>The story is still being written.</p>" }} />
        </section>
        <section className="panel" aria-labelledby="press-looks">
          <h2 id="press-looks">Looks</h2>
          <ul aria-label="Looks" className="press-looks">
            {payload.looks.map((look) => (
              <li key={look.id}>
                <img src={look.imageUrl} alt={look.altText} width={look.width} height={look.height} loading="lazy" />
                <p>{look.title}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="sticky-bar always" data-sticky-bar>
        <Button variant="primary" pending={pending} pendingText="Preparing download…" onClick={() => void download()}>
          <Download size={16} aria-hidden="true" focusable="false" />
          Download images
        </Button>
        <StatusRegion name="Download status" message={message} />
      </div>
    </div>
  );
}
