// `/commissions` — the client's commissions.
import { usd } from "../../shared/format";
import { Icon } from "../components/icons";
import { AppLink } from "../components/Shell";
import { Badge, Empty, Failed, Skeleton, useLoad, useScene } from "./common";

export interface CommissionRow {
  id: string; title: string; state: string; venueName: string; clientName: string; totalCents: number; paidCents: number;
  nextDueAt: string | null; nextDueCents: number | null; installDate: string | null;
}

export function Commissions() {
  useScene("working");
  const [load] = useLoad<{ commissions: CommissionRow[] }>("/api/commissions");
  const start = <AppLink href="/brief/new?step=1" className="button primary">Start a commission <Icon name="arrowRight" /></AppLink>;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Your commissions</p>
        <h1>Commissions</h1>
      </header>
      {load.status === "loading" && <Skeleton />}
      {load.status === "failed" && <Failed message={load.message} />}
      {load.status === "ready" && (load.data.commissions.length ? (
        <>
          <ul className="list" aria-label="Commissions">
            {load.data.commissions.map((c) => (
              <li key={c.id}>
                <AppLink href={`/c/${c.id}`} className="row-link">
                  <span className="section-head"><span>{c.title}</span><Badge state={c.state} on /></span>
                  <span className="muted">{c.venueName} · {c.nextDueCents !== null ? `Next due ${usd(c.nextDueCents)}` : "Nothing due"}</span>
                </AppLink>
              </li>
            ))}
          </ul>
          <div className="row-actions" style={{ marginTop: 24 }}>{start}</div>
        </>
      ) : <Empty question="Nothing commissioned yet. Start with the room?" drawing="room" action={start} />)}
    </main>
  );
}
