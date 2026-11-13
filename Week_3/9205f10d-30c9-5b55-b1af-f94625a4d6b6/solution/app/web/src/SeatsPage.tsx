import { useCallback, useEffect, useState } from "react";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api } from "./api";
import { clockOf, seatLine } from "./format";
import { JobPane, usePane } from "./JobPane";
import { REFRESH_MS, useInterval } from "./motion";
import { NotFound } from "./NotFound";
import { Link, navigate, usePlace } from "./router";
import type { SeatListing, User } from "./types";

type Kind = "open-seats" | "assignments";

const COPY: Record<Kind, { title: string; list: string; empty: string; url: string; key: "open_seats" | "assignments" }> = {
  "open-seats": {
    title: "Open seats",
    list: "Open seats",
    empty: "No open seats match your credentials and calendar right now.",
    url: "/api/open-seats",
    key: "open_seats",
  },
  assignments: {
    title: "My assignments",
    list: "My assignments",
    empty: "You hold no confirmed seats.",
    url: "/api/assignments",
    key: "assignments",
  },
};

/** Open seats and My assignments: a list of seats by start time, with the job detail beside it. */
export function SeatsPage({ viewer, kind }: { viewer: User; kind: Kind }) {
  const place = usePlace();
  const jobId = /^\/jobs\/([^/]+)$/.exec(place.path)?.[1] ?? null;
  const copy = COPY[kind];
  const [listing, setListing] = useState<SeatListing[] | null>(null);
  const [problem, setProblem] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [pane, exited] = usePane(jobId);

  const load = useCallback(async () => {
    const result = await api<Record<string, SeatListing[]>>("GET", copy.url);
    if (result.ok) {
      setListing(result.data[copy.key] ?? []);
      setProblem("");
    } else setProblem(result.error?.message ?? OFFLINE_COPY);
  }, [copy.url, copy.key]);
  useEffect(() => void load(), [load]);
  useInterval(() => void load(), REFRESH_MS);

  const listPath = kind === "assignments" ? "/assignments" : "/open-seats";
  const close = useCallback(() => {
    navigate(listPath);
    if (opened) document.querySelector<HTMLAnchorElement>(`[data-request-id="${opened}"]`)?.focus();
  }, [listPath, opened]);

  if (missing && missing === jobId) return <NotFound />;

  return (
    <div className="seats-page">
      <div className="seats-list-column">
        <h1>{copy.title}</h1>
        {problem && <p className="banner banner--alert">{problem}</p>}
        {listing === null ? (
          <Placeholder />
        ) : listing.length === 0 ? (
          <p className="empty">{copy.empty}</p>
        ) : (
          <ul className="seat-listing" aria-label={copy.list}>
            {listing.map(({ seat_id, seat_label, request }) => (
              <li key={seat_id} className={jobId === request.id ? "is-current" : undefined}>
                <span className="job-time">{clockOf(request.starts_at)}</span>
                <span className="listing-line">{seatLine(request, seat_label)}</span>
                <Link
                  to={`/jobs/${request.id}`}
                  state={{ from: kind }}
                  data-request-id={request.id}
                  className="listing-link"
                  onClick={() => setOpened(request.id)}
                >
                  View job {request.reference}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!pane && listing !== null && (
        <div className="pane-hint">
          <p className="pane-hint-title">No job selected</p>
          <p>
            {listing.length > 0
              ? "Choose View job to see the job's facts, seats and rotation here."
              : kind === "open-seats"
                ? "New seats appear here as coordinators post them; this list refreshes on its own."
                : "Seats you claim from Open seats appear here once confirmed."}
          </p>
        </div>
      )}
      {pane && (
        <JobPane
          key={pane.id}
          pane={pane}
          viewer={viewer}
          initial={listing?.find((l) => l.request.id === pane.id)?.request}
          openedByUser={opened === pane.id}
          onClose={close}
          onExited={exited}
          onMissing={() => setMissing(pane.id)}
        />
      )}
    </div>
  );
}
