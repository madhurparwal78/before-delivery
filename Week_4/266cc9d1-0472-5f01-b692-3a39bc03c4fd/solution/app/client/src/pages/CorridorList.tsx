// The corridor list: a table on tablet and desktop, stacked cards on phones, in the same order.
import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiFailure, type Corridor, type Staff } from "../api";
import { OverdueBadge } from "../components/bits";
import { inspectionDueLine, setStateLabel } from "../format";
import { navigate } from "../router";

function CorridorLink({ corridor }: { corridor: Corridor }) {
  return (
    <a
      className="corridor-name"
      href={`/corridors/${corridor.id}`}
      onClick={(event) => {
        event.preventDefault();
        navigate(`/corridors/${corridor.id}`);
      }}
    >
      {corridor.name}
    </a>
  );
}

export function CorridorListPage({ staff }: { staff: Staff }) {
  const [corridors, setCorridors] = useState<Corridor[] | null>(null);

  useEffect(() => {
    api<{ corridors: Corridor[] }>("GET", "/api/corridors")
      .then((read) => setCorridors(read.corridors))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) navigate("/");
      });
  }, []);

  const signOut = async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    navigate("/");
  };

  return (
    <main className="list-page">
      <div className="masthead">
        <p className="wordmark" style={{ fontSize: "var(--size-h3)" }}>
          Spanwise
        </p>
        <div className="who">
          <span className="meta">
            {staff.name} · {staff.tenant_name}
          </span>
          <button type="button" className="button quiet" onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
      <h1>Corridors</h1>
      {corridors === null ? (
        <div aria-busy="true">
          <p className="visually-hidden">Loading corridors</p>
          {[0, 1, 2].map((i) => (
            <div className="skeleton-row" key={i} />
          ))}
        </div>
      ) : (
        <>
          <table className="corridor-table" aria-label="Corridors">
            <thead>
              <tr>
                <th scope="col">Corridor</th>
                <th scope="col">Utility</th>
                <th scope="col">Inspection due</th>
                <th scope="col">Findings set</th>
              </tr>
            </thead>
            <tbody>
              {corridors.map((c) => (
                <tr key={c.id}>
                  <td>
                    <CorridorLink corridor={c} />
                    <div className="meta mono">{c.voltage_kv} kV</div>
                  </td>
                  <td>{c.utility.name}</td>
                  <td>
                    <span>{inspectionDueLine(c.inspection_due, c.utility.time_zone)}</span> {c.overdue && <OverdueBadge />}
                  </td>
                  <td className="state-word">{setStateLabel(c.current_set?.state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="corridor-cards" aria-label="Corridors">
            {corridors.map((c) => (
              <li key={c.id}>
                <CorridorLink corridor={c} />
                <span>{c.utility.name}</span>
                <span className="meta mono">{c.voltage_kv} kV</span>
                <span>
                  {inspectionDueLine(c.inspection_due, c.utility.time_zone)} {c.overdue && <OverdueBadge />}
                </span>
                <span className="state-word">{setStateLabel(c.current_set?.state)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
