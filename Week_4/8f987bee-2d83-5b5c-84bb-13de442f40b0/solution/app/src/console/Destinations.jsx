import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Discs } from "../components/Icons.jsx";
import { api } from "./api.js";
import { useConsole } from "./context.js";

export default function Destinations() {
  const { report } = useConsole();
  const [destinations, setDestinations] = useState(null);
  const [tables, setTables] = useState({});

  useEffect(() => {
    api("/api/destinations").then(async (result) => {
      if (!result.ok) {
        report(result);
        return;
      }
      // Newest first, so the destination someone just made sits at the top.
      const newest = [...result.body.destinations].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setDestinations(newest);
      const lists = await Promise.all(newest.map((d) => api(`/api/destinations/${d.id}/tables`)));
      setTables(Object.fromEntries(newest.map((d, i) => [d.id, lists[i].ok ? lists[i].body.tables : []])));
    });
  }, [report]);

  return (
    <div className="page">
      <div className="page-head"><h1>Destinations</h1></div>
      {destinations === null && <span className="skeleton" aria-hidden="true" />}
      {destinations?.map((destination) => (
        <section className="panel" key={destination.id} aria-labelledby={`dest-${destination.id}`}>
          <h2 id={`dest-${destination.id}`} className="panel-title"><Discs width="18" height="18" />{destination.name}</h2>
          <div className="table-frame" role="region" tabIndex={0} aria-label="Destination tables">
            <table className="data">
              <thead><tr><th scope="col">Table</th><th scope="col">Rows</th></tr></thead>
              <tbody>
                {(tables[destination.id] ?? []).map((table) => (
                  <tr key={table.name}>
                    <th scope="row" className="code"><Link to={`/app/destinations/${destination.id}/tables/${table.name}`}>{table.name}</Link></th>
                    <td className="num">{table.row_count.toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tables[destination.id]?.length === 0 && <p className="empty"><Discs />No tables yet. A table appears once a sync writes it.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
