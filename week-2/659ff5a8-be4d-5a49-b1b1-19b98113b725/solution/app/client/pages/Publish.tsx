import { useState } from "react";
import type { Publication } from "../../shared/api.js";
import { localStamp } from "../../shared/time.js";
import { ApiFailure, api } from "../api.js";
import { useEvent } from "../components/EventFrame.js";
import { Skeleton, StatusRegion } from "../components/ui.js";
import { useRefresh } from "../hooks.js";

const RENDERER_DOWN = "Results PDF renderer is offline. Publishing is paused and drivers have not been emailed.";
const STORAGE_DOWN = "Results storage is offline. Nothing was published and drivers have not been emailed.";
const MAIL_DOWN = "The mail server did not accept the results emails. Results are not published yet.";

export function Publish() {
  const { event, reload } = useEvent();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadPublication = useRefresh(
    async () => setPublication(await api.get<Publication>(`/api/events/${event.id}/publication`)),
    10,
    [event.id],
  );

  const publish = async (): Promise<void> => {
    setBusy(true);
    setMessage("Publishing final results");
    try {
      await api.post(`/api/events/${event.id}/publish`);
      setMessage("Final results published.");
    } catch (error) {
      setMessage(failure(error));
    } finally {
      setBusy(false);
      reload();
      reloadPublication();
    }
  };

  const published = event.status === "published";
  const rendererDown = publication?.renderer === "unavailable";
  return (
    <>
      <div className="page-head">
        <h1>Publish final results</h1>
      </div>
      {publication === null ? (
        <Skeleton rows={2} />
      ) : (
        <>
          {rendererDown ? (
            <div role="alert" className="banner">
              {RENDERER_DOWN}
            </div>
          ) : null}
          <p>
            {published
              ? "These results are published. Every checked-in driver has the results email."
              : event.status === "final"
                ? "Publishing renders the results PDF, stores it and emails every checked-in driver."
                : "Results can be published once the event is final."}
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || rendererDown || event.status !== "final"}
              aria-busy={busy}
              onClick={() => void publish()}
            >
              Publish final results
            </button>
          </div>
          <StatusRegion name="Publish progress">{message}</StatusRegion>
          {published && event.publishedAt !== null ? (
            <section className="panel" aria-label="Published result">
              <p>Published at {localStamp(new Date(event.publishedAt), event.timeZone)}</p>
              <p className="wrap">Checksum {event.resultsChecksum}</p>
              <p>
                <a className="btn btn-secondary" href={`/api/events/${event.id}/results.pdf`} download>
                  Download results PDF
                </a>
              </p>
              <p className="muted">
                Emails accepted: {publication.emailsAccepted} of {publication.emailsTotal}
              </p>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function failure(error: unknown): string {
  if (!(error instanceof ApiFailure)) return "Could not publish. Try again.";
  if (error.code === "renderer_unavailable") return RENDERER_DOWN;
  if (error.code === "storage_unavailable") return STORAGE_DOWN;
  if (error.code === "mail_unavailable") return MAIL_DOWN;
  return error.message;
}
