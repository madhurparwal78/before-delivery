// Handovers (brief: Screens and layout; DP-57..59).
import { useEffect, useRef, useState } from "react";
import { api, call, ApiError } from "../api";
import { announce } from "../announce";
import { changes, coalesce, refreshFolders, session } from "../data";
import { useStore } from "../store";
import { SOMETHING_WRONG } from "../copy";
import { Notices, ServiceBanner } from "../shell/Frame";
import { EmptyDrawing } from "../drawings";
import type { Handover } from "../../shared/api";

const STATUS: Record<Handover["status"], string> = { offered: "Open", accepted: "Accepted", declined: "Declined", lapsed: "Lapsed" };

export function HandoversScreen() {
  const me = useStore(session);
  const [list, setList] = useState<Handover[] | null>(null);
  const load = useRef(coalesce(() => {
    void api<{ handovers: Handover[] }>("GET", "/api/handovers").then((body) => setList(body.handovers), () => undefined);
  }));

  useEffect(() => {
    load.current();
    return changes.on("change", (kind) => {
      if (kind === "handovers" || kind === "folders" || kind === "day" || kind === "all") load.current();
    });
  }, []);

  const decide = async (handover: Handover, outcome: "accept" | "decline") => {
    try {
      await call("POST", `/api/handovers/${handover.id}/${outcome}`);
      announce(outcome === "accept" ? `You now own ${handover.folder.name}` : `Declined ${handover.folder.name}`);
      void refreshFolders();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code === "handover_lapsed") announce(`This handover lapsed at the end of ${handover.lapseDate}.`);
      else if (failure.code === "handover_accepted" || failure.code === "handover_declined") {
        announce(`This handover was already ${failure.code === "handover_accepted" ? "accepted" : "declined"}.`);
      } else announce(SOMETHING_WRONG);
    }
    load.current();
  };

  return (
    <main className="centre centre-plain" id="files" tabIndex={-1}>
      <div className="page-head"><h1>Handovers</h1><p className="page-sub">Project offers between staff. An offer lapses at Phoenix midnight after its last day.</p></div>
      <Notices />
      <ServiceBanner />
      {list && !list.length && <div className="empty"><EmptyDrawing /><p>There are no handovers.</p></div>}
      {list && list.length > 0 && (
        <table aria-label="Handovers" className="table">
          <thead><tr><th scope="col">Folder</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Offered</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.id}>
                <td data-label="Folder" className="cell-name">{h.folder.name}</td>
                <td data-label="From">{h.from.name}</td>
                <td data-label="To">{h.to.name}</td>
                <td data-label="Offered" className="num">{h.offeredDate}</td>
                <td data-label="Status">{h.status === "offered" ? <>Open until <span className="num">{h.lapseDate}</span></> : <span className={h.status === "lapsed" ? "warn" : ""}>{STATUS[h.status]}</span>}</td>
                <td className="cell-actions">
                  {h.status === "offered" && h.to.id === me?.id && (
                    <>
                      <button type="button" className="button compact primary" aria-label={`Accept ${h.folder.name}`} onClick={() => void decide(h, "accept")}>Accept</button>
                      <button type="button" className="button compact" aria-label={`Decline ${h.folder.name}`} onClick={() => void decide(h, "decline")}>Decline</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
