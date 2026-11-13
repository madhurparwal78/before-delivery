// `/crew` (the crew lead's assigned install days) and `/crew/days/<install day id>` (the day sheet).
import { formatDay, metres } from "../../shared/format";
import { pieceLabel, type PieceKind, type Venue } from "../../shared/catalog";
import { AppLink } from "../components/Shell";
import { Empty, Failed, Missing, Skeleton, useLoad, useScene, type LayoutItem } from "./common";
import { moveCommission } from "./Overview";

interface DaySheetView {
  id: string; commissionId: string; commissionTitle: string; commissionState: string; clientName: string; venue: Venue; date: string;
  startsAt: string; endsAt: string; layout: { version: number; items: LayoutItem[] }; alerts: { kind: string; title: string; sendAt: string; status: string }[];
}

export function CrewDays() {
  useScene("working");
  const [load] = useLoad<{ installDays: DaySheetView[] }>("/api/install-days");
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Install crew</p>
        <h1>Install days</h1>
      </header>
      {load.status === "loading" && <Skeleton rows={3} />}
      {load.status === "failed" && <Failed message={load.message} />}
      {load.status === "ready" && (load.data.installDays.length ? (
        <ul className="list" aria-label="Install days">
          {load.data.installDays.map((d) => (
            <li key={d.id}>
              <AppLink href={`/crew/days/${d.id}`} className="row-link">
                <span>{formatDay(d.date)}</span>
                <span>{d.commissionTitle}</span>
                <span className="muted">{d.venue.name}, {d.venue.city}</span>
              </AppLink>
            </li>
          ))}
        </ul>
      ) : <Empty question="No install days yet. Check back after a booking?" drawing="calendar" />)}
    </main>
  );
}

const addDay = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function DaySheet({ id }: { id: string }) {
  useScene("working");
  const [load, reload] = useLoad<DaySheetView>(`/api/install-days/${id}`);
  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  if (load.status === "loading") return <main className="column"><Skeleton rows={4} /></main>;
  const d = load.data;
  const loadIn = d.alerts.find((a) => a.kind === "load_in");
  const confirmed = ["installed", "accepted", "maintained"].includes(d.commissionState);
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">Day sheet</p>
        <h1>{d.commissionTitle}</h1>
      </header>
      <div className="panel stack">
        <dl className="facts">
          <dt>Venue</dt><dd>{d.venue.name}, {d.venue.address}, {d.venue.city}</dd>
          <dt>Date</dt><dd>{formatDay(d.date)} ({d.venue.timeZone})</dd>
          <dt>Client</dt><dd>{d.clientName}</dd>
          <dt>Load-in alert</dt><dd>{loadIn ? <>{loadIn.title}<br /><span className="muted">{loadIn.status === "sent" ? "Sent" : `Scheduled for ${formatDay(addDay(d.date, -1))}, 09:00 (${d.venue.timeZone})`}</span></> : "—"}</dd>
        </dl>
      </div>
      <section className="section" aria-labelledby="pieces-title">
        <h2 id="pieces-title">Pieces</h2>
        <ul className="list" aria-label="Pieces">
          {d.layout.items.map((i) => <li key={i.kind}>{pieceLabel(i.kind as PieceKind)} at {metres(i.x)} m, {metres(i.y)} m, turned {i.rotationDeg}°</li>)}
        </ul>
      </section>
      <section className="section">
        {confirmed ? <p className="badge on">Installation confirmed</p> : (
          <button type="button" className="button primary" style={{ width: "100%" }} onClick={() => void moveCommission(d.commissionId, "installed").then(async (ok) => {
            if (ok) await reload();
          })}>Confirm installation</button>
        )}
      </section>
    </main>
  );
}
