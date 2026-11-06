// Public inspector page: one tenant's current documents behind an expiring link.
import { FileText } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import type { InspectionView } from "../../shared/api";
import { KIND_LABELS, PRODUCT_NAME } from "../../shared/kitchen";
import { kitchenStamp } from "../../shared/time";
import { api, download } from "../api";
import { STORAGE_TRY_AGAIN, act } from "../feedback";
import { StatusLine } from "../ui/parts";

type View = { state: "loading" } | { state: "dead" } | { state: "ready"; view: InspectionView };

export function InspectScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ state: "loading" });

  useEffect(() => {
    void act(
      {
        pending: "Loading documents…",
        error: (f) => (f.status === 404 || f.status === 410 ? false : null),
      },
      () => api<InspectionView>("GET", `/api/inspect/${encodeURIComponent(token)}`),
    ).then((outcome) => {
      if (outcome.ok) setView({ state: "ready", view: outcome.value });
      else if (outcome.failure.status === 404 || outcome.failure.status === 410) setView({ state: "dead" });
    });
  }, [token]);

  const open = (url: string, name: string): void => {
    void act(
      {
        pending: "Opening file…",
        services: ["storage"],
        error: (f) => (f.code === "storage_unavailable" ? STORAGE_TRY_AGAIN : f.status === 410 ? false : null),
      },
      () => download(url, name),
    ).then((outcome) => {
      if (!outcome.ok && outcome.failure.status === 410) setView({ state: "dead" });
    });
  };

  return (
    <div class="inspect-page">
      <header class="inspect-bar">
        <span class="brand">{PRODUCT_NAME}</span>
        <span class="inspect-tag">Inspection view · read only</span>
      </header>
      <StatusLine />
      <main class="content inspect">
        {view.state === "dead" && <h1>This inspection link is no longer valid</h1>}
        {view.state === "ready" && (
          <article class="inspect-sheet">
            <h1>{view.view.business_name}</h1>
            <p class="inspect-sub">Current documents at {view.view.kitchen_name}</p>
            <ul class="inspect-list" aria-label="Current documents">
              {view.view.documents.map((doc, index) => {
                const label = `Open ${KIND_LABELS[doc.kind]}${doc.kind === "food_handler_card" && doc.holder_name ? `, ${doc.holder_name}` : ""}`;
                return (
                  <li key={doc.id}>
                    <span class="row-num mono">{String(index + 1).padStart(2, "0")}</span>
                    <span class="inspect-doc">
                      <a
                        href={doc.file_url}
                        onClick={(e) => {
                          e.preventDefault();
                          open(doc.file_url, `${doc.kind}.pdf`);
                        }}
                      >
                        <FileText size={16} aria-hidden="true" />
                        {label}
                      </a>
                      <span class="muted">
                        Valid through <span class="mono">{doc.expires_on}</span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p class="inspect-expiry">This link expires {kitchenStamp(Date.parse(view.view.expires_at))} kitchen time.</p>
          </article>
        )}
      </main>
    </div>
  );
}
