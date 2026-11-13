import type { ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { notify } from "../lib/notices";
import { useProject } from "./context";

export function ExportsTable(): ReactNode {
  const { state } = useProject();
  const owner = state.role === "owner";
  const cancel = async (id: string): Promise<void> => {
    notify("Cancelling…");
    try {
      await api.post(`/api/exports/${id}/cancel`);
      notify("Export cancelled.");
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      notify(failure.message);
    }
  };
  return (
    <section role="region" aria-label="Exports" className="exports">
      {state.exports.length === 0 ? <p className="empty">No exports yet.</p> : null}
      <ul className="plain-list table">
        {state.exports.map((item) => {
          const label = `${item.cut_name} ${item.size}p`;
          const text =
            item.state === "running"
              ? `Running · ${item.progress}%`
              : item.state === "done"
                ? item.stale
                  ? `Stale · from ${item.cut_name}`
                  : "Done"
                : item.state === "queued"
                  ? "Queued"
                  : item.state === "cancelled"
                    ? "Cancelled"
                    : "Failed";
          return (
            <li key={item.id}>
              <span>{label}</span> <span className="muted tnum">{text}</span>
              {item.state === "queued" || item.state === "running" ? <span className="bar" style={{ width: `${item.progress}px` }} aria-hidden="true" /> : null}{" "}
              {owner && (item.state === "queued" || item.state === "running") ? (
                <button type="button" aria-label={`Cancel export ${label}`} onClick={() => void cancel(item.id)}>
                  Cancel
                </button>
              ) : null}
              {item.state === "done" ? (
                <a href={`/api/exports/${item.id}/manifest`} aria-label={`Manifest ${label}`}>
                  Manifest
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
