// `/i/<token>` (the sponsor invite) and `/c/<commission id>/share` (the sponsor's own share).
import { useEffect, useRef, useState } from "react";
import { INSTALLATIONS, STUDIO_NAME, type InstallationType } from "../../shared/catalog";
import { formatDay, percent, usd } from "../../shared/format";
import { CueLine } from "../components/CueLine";
import { PaymentSheet } from "../components/Pay";
import { AppLink } from "../components/Shell";
import { HttpError, call, signInHref } from "../lib/api";
import { toast } from "../lib/notices";
import { navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { Badge, Failed, Missing, Skeleton, failureText, useScene } from "./common";

interface Summary { title: string; venueName: string; installationType: InstallationType; installDate: string | null; studioName?: string }
interface InviteView { commission: Summary; share: { sponsorName: string; bp: number; subtotalCents: number; taxCents: number; amountCents: number }; expiresAt: string }
interface ShareView {
  commission: Summary;
  share: { id: string; sponsorName: string; bp: number; subtotalCents: number; taxCents: number; amountCents: number; state: string; dueAt: string | null; dueText: string | null; killbillInvoiceId: string | null; documentId: string | null };
}

function SummaryFacts({ s }: { s: Summary }) {
  return (
    <dl className="facts">
      <dt>Piece</dt><dd>{s.title}</dd>
      <dt>Installation</dt><dd>{INSTALLATIONS[s.installationType].label}</dd>
      <dt>Venue</dt><dd>{s.venueName}</dd>
      <dt>Install day</dt><dd>{s.installDate ? formatDay(s.installDate) : "Not booked yet"}</dd>
      <dt>Studio</dt><dd>{s.studioName ?? STUDIO_NAME}</dd>
    </dl>
  );
}

export function Invite({ token }: { token: string }) {
  useScene("working");
  const { search } = useLocation();
  const session = useSession();
  const [view, setView] = useState<InviteView | "expired" | "invalid" | null>(null);
  const accepting = useRef(false);
  const wantsAccept = new URLSearchParams(search).get("accept") === "1";

  useEffect(() => {
    call<InviteView>(`/api/invites/${token}`).then(setView, (error: unknown) => {
      setView(error instanceof HttpError && error.status === 410 ? "expired" : "invalid");
    });
  }, [token]);

  const accept = async (): Promise<void> => {
    if (accepting.current) return;
    accepting.current = true;
    try {
      const result = await call<{ commissionId: string }>(`/api/invites/${token}/accept`, { method: "POST" });
      toast("You're in. Here's your share.");
      navigate(`/c/${result.commissionId}/share`, { replace: true });
    } catch (error) {
      if (error instanceof HttpError && error.code === "invite_used") toast("This invite was already accepted by another account.");
      else if (error instanceof HttpError && error.code === "invite_expired") setView("expired");
      else toast(failureText(error));
    } finally {
      accepting.current = false;
    }
  };

  useEffect(() => {
    if (wantsAccept && session.status === "in") void accept();
  }, [wantsAccept, session.status]);

  if (view === "expired") {
    return (
      <main className="column">
        <header className="page-head"><h1>This invite has expired</h1><p>Ask Spindrift Rooms for a new link.</p></header>
        <AppLink href="/" className="button">Back to Spindrift Rooms</AppLink>
      </main>
    );
  }
  if (view === "invalid") {
    return (
      <main className="column">
        <header className="page-head"><h1>This invite link isn't valid</h1><p>It may have been replaced or withdrawn. Ask Spindrift Rooms for a new link.</p></header>
        <AppLink href="/" className="button">Back to Spindrift Rooms</AppLink>
      </main>
    );
  }
  if (!view) return <main className="column"><Skeleton rows={3} /></main>;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Co-funding invite for {view.share.sponsorName}</p>
        <CueLine text={`Fund ${view.commission.title}?`} />
      </header>
      <div className="panel stack">
        <SummaryFacts s={view.commission} />
      </div>
      <section className="section" aria-labelledby="share-title">
        <h2 id="share-title">Your share</h2>
        <div className="panel stack">
          <dl className="facts">
            <dt>Share</dt><dd>{percent(view.share.bp)}%</dd>
            <dt>Work</dt><dd>{usd(view.share.subtotalCents)}</dd>
            <dt>Sales tax</dt><dd>{usd(view.share.taxCents)}</dd>
            <dt>Total</dt><dd>{usd(view.share.amountCents)}</dd>
          </dl>
        </div>
        <div className="row-actions">
          <button type="button" className="button primary" onClick={() => {
            if (session.status === "in") void accept();
            else location.assign(signInHref(`/i/${token}?accept=1`));
          }}>Accept and sign in</button>
        </div>
        <p className="muted">This link works until {new Date(view.expiresAt).toUTCString()}.</p>
      </section>
    </main>
  );
}

export function Share({ id }: { id: string }) {
  useScene("working");
  const [view, setView] = useState<ShareView | "missing" | string | null>(null);
  const [paying, setPaying] = useState(false);
  const load = (): void => {
    call<ShareView>(`/api/commissions/${id}/share`).then(setView, (error: unknown) => {
      if (error instanceof HttpError && error.status === 401 && error.code === "unauthenticated") location.assign(signInHref(`/c/${id}/share`));
      else setView(error instanceof HttpError && error.status === 404 ? "missing" : failureText(error));
    });
  };
  useEffect(load, [id]);

  if (view === "missing") return <Missing />;
  if (typeof view === "string") return <Failed message={view} />;
  if (!view) return <main className="column"><Skeleton rows={3} /></main>;
  const { share } = view;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Sponsor share · {share.sponsorName}</p>
        <h1>{view.commission.title}</h1>
      </header>
      <div className="panel stack"><SummaryFacts s={view.commission} /></div>
      <section className="section" aria-labelledby="mine-title">
        <h2 id="mine-title">Your share</h2>
        <div className="panel stack">
          <dl className="facts">
            <dt>Share</dt><dd>{percent(share.bp)}%</dd>
            <dt>Work</dt><dd>{usd(share.subtotalCents)}</dd>
            <dt>Sales tax</dt><dd>{usd(share.taxCents)}</dd>
            <dt>Total</dt><dd>{usd(share.amountCents)}</dd>
            <dt>Due by</dt><dd>{share.dueText ?? "—"}</dd>
            <dt>State</dt><dd><Badge state={share.state} on={share.state === "paid"} /></dd>
          </dl>
          {share.documentId && <a href={`/api/documents/${share.documentId}/pdf`} target="_blank" rel="noreferrer">Open the invoice PDF</a>}
        </div>
        {share.state !== "paid" && (
          <div className="row-actions"><button type="button" className="button primary" onClick={() => setPaying(true)}>Pay my share</button></div>
        )}
      </section>
      {paying && (
        <PaymentSheet amountCents={share.amountCents} path={`/api/funders/${share.id}/payments`} onClose={() => setPaying(false)} onPaid={load} />
      )}
    </main>
  );
}
