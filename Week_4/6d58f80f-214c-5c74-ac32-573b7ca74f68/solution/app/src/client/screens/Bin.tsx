// The bin (brief: Screens and layout; DP-52, DP-53): days left with the rule that applies, Restore and Delete forever.
import { useEffect, useRef, useState } from "react";
import { api, call, ApiError } from "../api";
import { announce } from "../announce";
import { changes, coalesce, refreshFolders, refreshStorage, session } from "../data";
import { useStore } from "../store";
import { binDaysLeft, formatSize } from "../format";
import { BIN_EMPTY, SOMETHING_WRONG } from "../copy";
import { Dialog } from "../widgets/Dialog";
import { Notices, ServiceBanner } from "../shell/Frame";
import { EmptyDrawing } from "../drawings";
import { Icon } from "../icons";
import type { BinItem } from "../../shared/api";

export function BinScreen() {
  const me = useStore(session);
  const [items, setItems] = useState<BinItem[] | null>(null);
  const [confirming, setConfirming] = useState<BinItem | null>(null);
  const controller = me?.staffRole === "controller";
  const load = useRef(coalesce(() => {
    void api<{ items: BinItem[] }>("GET", "/api/bin").then((body) => setItems(body.items), () => undefined);
  }));

  useEffect(() => {
    load.current();
    return changes.on("change", (kind) => {
      if (kind === "files" || kind === "day" || kind === "all" || kind === "moved") load.current();
    });
  }, []);

  const restore = async (item: BinItem) => {
    try {
      await call("POST", `/api/bin/${item.file.id}/restore`);
      announce(`Restored ${item.file.name} to ${item.fromFolder.name}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(SOMETHING_WRONG);
    }
    load.current();
    void refreshFolders();
  };

  const destroy = async (item: BinItem) => {
    setConfirming(null);
    try {
      await call("DELETE", `/api/bin/${item.file.id}`);
      announce(`Deleted ${item.file.name} forever`);
      void refreshStorage();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(failure.code === "storage_unavailable" ? `File storage is unreachable. ${item.file.name} was not deleted.` : SOMETHING_WRONG);
    }
    load.current();
  };

  return (
    <main className="centre centre-plain" id="files" tabIndex={-1}>
      <div className="page-head"><h1>Bin</h1><p className="page-sub">Binned files are purged for good at the start of their purge date, Phoenix time.</p></div>
      <Notices />
      <ServiceBanner />
      {items && !items.length && <div className="empty"><EmptyDrawing /><p>{BIN_EMPTY}</p></div>}
      {items && items.length > 0 && (
        <table aria-label="Binned files" className="table">
          <thead><tr><th scope="col">Name</th><th scope="col">From</th><th scope="col">Binned</th><th scope="col">Days left</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.file.id}>
                <td data-label="Name"><span className="cell-name">{item.file.name}</span> <span className="num muted">{formatSize(item.file.size)}</span></td>
                <td data-label="From">{item.fromFolder.name}</td>
                <td data-label="Binned" className="num">{item.binnedDate}</td>
                <td data-label="Days left" className={item.purgePending || item.daysLeft <= 1 ? "num warn" : "num"}>{binDaysLeft(item)}</td>
                <td className="cell-actions">
                  <button type="button" className="button compact" aria-label={`Restore ${item.file.name}`} onClick={() => void restore(item)}><Icon name="restore" />Restore</button>
                  {controller && (
                    <button type="button" className="button compact danger" aria-label={`Delete ${item.file.name} forever`} onClick={() => setConfirming(item)}><Icon name="trash" />Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming && (
        <Dialog title="Delete forever?" role="alertdialog" onClose={() => setConfirming(null)} describedBy="delete-copy">
          <p id="delete-copy">{confirming.file.name} will be removed for good.</p>
          <div className="dialog-actions">
            <button type="button" className="button danger-solid" onClick={() => void destroy(confirming)}>Delete forever</button>
            <button type="button" className="button" onClick={() => setConfirming(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
