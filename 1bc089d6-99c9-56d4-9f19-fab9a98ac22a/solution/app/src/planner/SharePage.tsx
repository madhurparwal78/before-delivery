import { useEffect, useState } from "react";

import lanternOut from "../story/components/lantern-out.svg";
import { api, type SharedPlan } from "./api";
import { startsAt } from "../shared/hour";
import { PageShell } from "./PageShell";

type View = { kind: "loading" } | { kind: "ready"; plan: SharedPlan } | { kind: "gone" } | { kind: "unavailable"; message: string };

const GONE = "This shared hour is no longer available.";

/** /p/<token>: a keeper's hour shared with a partner, read only. */
export function SharePage() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    const token = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
    void api<{ plan: SharedPlan }>("GET", `/api/share/${encodeURIComponent(token)}`).then((result) => {
      if (result.ok) setView({ kind: "ready", plan: result.data.plan });
      else if (result.status === 404) setView({ kind: "gone" });
      else setView({ kind: "unavailable", message: result.message ?? GONE });
    });
  }, []);

  return (
    <PageShell busy={view.kind === "loading"}>
      <section className="sh-panel sh-panel--centred" aria-labelledby="shared-title">
        {view.kind === "gone" ? (
          <>
            <img className="sh-empty-art" src={lanternOut} alt="" width={120} height={168} />
            <h1 className="sh-page__title" id="shared-title">
              {GONE}
            </h1>
            <p>The link was turned off or replaced by a newer one.</p>
          </>
        ) : (
          <h1 className="sh-page__title" id="shared-title">
            A shared Stillhour
          </h1>
        )}
        {view.kind === "loading" ? (
          <p className="sh-live" role="status">
            Opening the shared hour…
          </p>
        ) : null}
        {view.kind === "unavailable" ? (
          <p className="sh-live" role="status">
            {view.message}
          </p>
        ) : null}
        {view.kind === "ready" ? (
          <>
            <p className="sh-shared__when">
              Winding down from {startsAt(view.plan.bedtime)} for bed at {view.plan.bedtime}, {view.plan.time_zone} time.
            </p>
            <ol className="sh-shared__list" aria-label="Rituals">
              {view.plan.rituals.map((ritual) => (
                <li key={ritual.id} className="sh-shared__item">
                  {ritual.title} · {ritual.minutes} min
                </li>
              ))}
            </ol>
            <p className="sh-shared__total">{view.plan.total_minutes} minutes in all</p>
          </>
        ) : null}
        <p className="sh-panel__actions">
          <a className="sh-button sh-button--quiet" href="/">
            Plan your own hour
          </a>
        </p>
      </section>
    </PageShell>
  );
}
