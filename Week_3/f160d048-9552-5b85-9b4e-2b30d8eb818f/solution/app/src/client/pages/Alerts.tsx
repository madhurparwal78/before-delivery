import { api, get, post } from "../api";
import { useLoad } from "../hooks";
import { useLive, useLiveReload } from "../live";
import { Link } from "../router";
import { Screen } from "../shell/Page";
import type { AlertRow } from "../../shared/api";

const newText = (count: number): string => (count === 0 ? "No new jobs" : count === 1 ? "1 new job" : `${count} new jobs`);

export function Alerts() {
  const alerts = useLoad(() => get<{ alerts: AlertRow[] }>("/api/alerts"), []);
  useLive("alert.matched", (event) =>
    alerts.patch((current) => ({ alerts: current.alerts.map((alert) => (alert.id === event.alert_id ? { ...alert, new_count: event.new_count } : alert)) })),
  );
  useLiveReload(alerts.reload);

  const list = alerts.data?.alerts;
  return (
    <Screen title="Alerts">
      <h1 className="page-title">Alerts</h1>
      {list && list.length === 0 ? (
        <div className="empty">
          <p>You have no saved alerts yet.</p>
          <Link to="/jobs" className="btn">Search lab jobs</Link>
        </div>
      ) : null}
      <ul className="items" aria-label="Saved alerts">
        {(list ?? []).map((alert) => (
          <li key={alert.id} data-id={alert.id}>
            <p className="item-title">{alert.label}</p>
            <p className="meta figure">{newText(alert.new_count)}</p>
            <div className="row">
              <Link to={`/jobs?${alert.search}`} onNavigate={() => void post(`/api/alerts/${alert.id}/seen`)} aria-label={`See jobs for ${alert.label}`}>
                See jobs for {alert.label}
              </Link>
              <button
                type="button"
                className="btn-quiet"
                aria-label={`Delete alert ${alert.label}`}
                onClick={() => void api("DELETE", `/api/alerts/${alert.id}`).then(alerts.reload)}
              >
                Delete alert
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
