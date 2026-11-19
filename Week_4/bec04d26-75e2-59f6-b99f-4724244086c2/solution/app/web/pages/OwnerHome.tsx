import { useState } from "react";
import { EmptyTile, ReturnTile, returnData } from "../components/Tile";
import { OwnerBar } from "../components/OwnerBar";
import { useReturnList } from "../hooks";
import { Link } from "../router";

export function OwnerHome() {
  const list = useReturnList("/api/returns");
  const [picked, setPicked] = useState<string | null>(null);
  const all = list?.returns ?? [];
  const waiting = all.filter((r) => r.awaiting_approval);
  const selected = waiting.find((r) => r.id === picked) ?? waiting[0];

  return (
    <main className="owner-home">
      <h1>Awaiting your approval</h1>
      {selected ? (
        <>
          <div className="home-specimen">
            <ReturnTile view={selected} className="home-tile" />
            <p className="caption"><strong>{selected.client.name}</strong><span>{selected.due_line}</span></p>
          </div>
          <ul aria-label="Your returns" className="name-row">
            {waiting.map((r) => (
              <li key={r.id}>
                <button type="button" aria-pressed={r.id === selected.id} onClick={() => setPicked(r.id)} {...returnData(r)}>
                  {`${r.state} ${r.period_label}`}
                </button>
              </li>
            ))}
          </ul>
          <OwnerBar view={selected} />
        </>
      ) : list && <EmptyTile>Nothing is waiting for your approval.</EmptyTile>}
      <h2>All your returns</h2>
      <section aria-label="All your returns" className="all-returns">
        <ul>
          {all.map((r) => (
            <li key={r.id} {...returnData(r)} className={`row tone-${r.tone}`}>
              <Link href={`/returns/${r.id}`}>
                <strong>{`${r.state} ${r.period_label}`}</strong>
                <span>{r.overdue ? `${r.status_label} · Overdue` : r.status_label}</span>
                <span className="muted">{r.due_line}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
