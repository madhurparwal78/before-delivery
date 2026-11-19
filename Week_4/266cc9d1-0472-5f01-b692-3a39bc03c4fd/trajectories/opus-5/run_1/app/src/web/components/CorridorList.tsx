import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api.js";
import { useLayout } from "../lib/hooks.js";
import { inspectionDueLine, setStateWord } from "../../shared/format.js";
import type { Corridor } from "../lib/types.js";

function DueLine({ corridor }: { corridor: Corridor }): ReactNode {
  return (
    <span className="mono">
      {inspectionDueLine(corridor.inspection_due, corridor.utility.time_zone)}
    </span>
  );
}

function OverdueBadge(): ReactNode {
  return <span className="badge badge--overdue">Overdue</span>;
}

export function CorridorList(): ReactNode {
  const [corridors, setCorridors] = useState<Corridor[] | null>(null);
  const layout = useLayout();

  useEffect(() => {
    void api<{ corridors: Corridor[] }>("GET", "/api/corridors").then((result) =>
      setCorridors(result.corridors),
    );
  }, []);

  return (
    <main className="list-page">
      <h1>Corridors</h1>
      {corridors === null ? null : layout === "phone" ? (
        <ul className="corridor-cards" aria-label="Corridors">
          {corridors.map((corridor) => (
            <li key={corridor.id} className="corridor-card">
              <a className="corridor-card__name" href={`/corridors/${corridor.id}`}>
                {corridor.name}
              </a>
              <p className="corridor-card__utility">{corridor.utility.name}</p>
              <p className="corridor-card__voltage mono">{corridor.voltage_kv} kV</p>
              <p>
                <DueLine corridor={corridor} /> {corridor.overdue ? <OverdueBadge /> : null}
              </p>
              <p className="corridor-card__state">{setStateWord(corridor.current_set?.state)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <table className="corridor-table">
          <caption className="visually-hidden">Corridors</caption>
          <thead>
            <tr>
              <th scope="col">Corridor</th>
              <th scope="col">Utility</th>
              <th scope="col">Inspection due</th>
              <th scope="col">Findings set</th>
            </tr>
          </thead>
          <tbody>
            {corridors.map((corridor) => (
              <tr key={corridor.id}>
                <td>
                  <a href={`/corridors/${corridor.id}`}>{corridor.name}</a>
                  <span className="mono corridor-table__voltage">{corridor.voltage_kv} kV</span>
                </td>
                <td>{corridor.utility.name}</td>
                <td>
                  <DueLine corridor={corridor} /> {corridor.overdue ? <OverdueBadge /> : null}
                </td>
                <td>{setStateWord(corridor.current_set?.state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
