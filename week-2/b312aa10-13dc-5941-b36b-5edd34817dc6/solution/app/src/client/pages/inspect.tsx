import { useEffect, useState } from "preact/hooks";
import { ApiFailure, get } from "../api.js";
import { LiveRegions } from "../shell.js";
import { clearError, showError } from "../store.js";
import { Empty } from "../ui.js";
import { LogTable } from "./sanitation.js";
import type { InspectorView } from "../types.js";
import { DOCUMENT_TYPES } from "../../shared/format.js";
import { localStamp, monthName } from "../../shared/time.js";
import { COPY, NETWORK_COPY, variantCopy } from "../../shared/copy.js";

const STATUS: Record<string, string> = { approved: "Approved", expiring: "Expiring", expired: "Expired" };
const GONE: Record<string, string> = {
  link_expired: COPY.link_expired!,
  link_revoked: COPY.link_revoked!,
  not_found: "This link is not valid.",
};

/**
 * A download stays on the page: the file is fetched and saved only on a 200. A 410 replaces the
 * whole view with the link's state copy; a 503 or 404 shows its copy in the alert.
 */
async function download(url: string, fallbackName: string, onGone: (copy: string) => void): Promise<void> {
  clearError();
  let response: Response;
  try {
    response = await fetch(url, { credentials: "omit", cache: "no-store" });
  } catch {
    showError("Lineboard could not reach the server. Check the connection and try again.");
    return;
  }
  if (response.status === 200) {
    const blob = await response.blob();
    const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = named?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    return;
  }
  let code = "";
  try {
    code = String(((await response.json()) as { error?: unknown }).error ?? "");
  } catch {
    code = "";
  }
  if (response.status === 410 && (code === "link_expired" || code === "link_revoked")) onGone(GONE[code]!);
  else if (response.status === 503) showError(variantCopy("storage_unavailable_download"));
  else if (response.status === 404) showError(COPY.not_found!);
  else showError(COPY.internal!);
}

/** The inspector's read-only view: loaded once per page load, never polled; every label comes from the server. */
export function InspectScreen({ token }: { token: string }) {
  const [view, setView] = useState<InspectorView | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    get<InspectorView>(`/api/inspect/${encodeURIComponent(token)}`).then(({ data }) => setView(data), (error: unknown) => {
      setGone(error instanceof ApiFailure ? GONE[error.code] ?? NETWORK_COPY : "This link is not valid.");
    });
  }, [token]);
  const base = `/api/inspect/${encodeURIComponent(token)}`;
  const gone_ = (copy: string): void => {
    setView(null);
    setGone(copy);
  };
  const fetchFile = (url: string, name: string) => (e: Event): void => {
    e.preventDefault();
    void download(url, name, gone_);
  };
  return (
    <div class="frame inspect">
      <LiveRegions />
      <main class="main">
        {gone && (
          <section class="panel panel-gone">
            <p class="kitchen-name">Lineboard</p>
            <p class="gone">{gone}</p>
          </section>
        )}
        {!gone && !view && <p class="loading">Loading…</p>}
        {view && (
          <div class="screen">
            <h1>{view.kitchen.name}</h1>
            <p class="lede">Read-only records for {view.kitchen.name}, available until {localStamp(Date.parse(view.expiresAt), view.kitchen.timeZone)}</p>
            <section class="panel">
              <h2>Sanitation log</h2>
              <p class="panel-note">The last 90 days, newest first, in kitchen time ({view.kitchen.timeZone})</p>
              <LogTable entries={view.sanitationEntries} empty="No sanitation entries in the last 90 days." />
            </section>
            <section class="panel">
              <h2>Monthly PDFs</h2>
              <ul class="pdf-list" aria-label="Monthly PDFs">
                {view.sanitationReports.map((r) => <li><a href={`${base}/sanitation-reports/${r.month}/file`} onClick={fetchFile(`${base}/sanitation-reports/${r.month}/file`, `sanitation-${r.month}.pdf`)}>Sanitation PDF {monthName(r.month)}</a></li>)}
              </ul>
              {view.sanitationReports.length === 0 && <Empty>No monthly PDFs saved yet.</Empty>}
            </section>
            <section class="panel">
              <h2>Member certificates</h2>
              <table class="table" aria-label="Member certificates">
                <thead><tr><th scope="col">Business</th><th scope="col">Document</th><th scope="col">Expiry date</th><th scope="col">Status</th><th scope="col">File</th></tr></thead>
                <tbody>
                  {view.certificates.map((c) => (
                    <tr>
                      <td data-label="Business">{c.businessName}</td>
                      <td data-label="Document">{DOCUMENT_TYPES[c.type]}</td>
                      <td data-label="Expiry date">{c.expiryDate}</td>
                      <td data-label="Status">{STATUS[c.status] ?? c.status}</td>
                      <td data-label="File"><a href={`${base}/documents/${c.documentId}/file`} onClick={fetchFile(`${base}/documents/${c.documentId}/file`, c.documentId)}>Download {c.businessName} {DOCUMENT_TYPES[c.type]}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
