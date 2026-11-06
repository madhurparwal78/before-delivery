// Releases (brief: Screens and layout › Releases; Interactions › Releases table focus). Each row
// shows only its legal actions and the hold label while it applies; the table re-reads every 10 s.
import { useEffect, useState } from "react";
import type { Hold, Item, Release, ReleaseStatus } from "../../shared/api.js";
import { OPEN_RELEASE, releaseActionAllowed, type ReleaseAction } from "../../shared/transitions.js";
import { HttpError, Interrupted, NoAnswer, errorCode, get, request } from "../api.js";
import { applyInPlace, usePoll } from "../hooks.js";
import { RELEASE_STATUS_LABEL, SIGNED_IN_AGAIN } from "../labels.js";
import { StatusRegion, useNote } from "../ui/Feedback.js";
import { Icon } from "../ui/Icon.js";

const ACTION_LABEL: Record<ReleaseAction, string> = {
  book: "Book release",
  stage: "Car staged",
  complete: "Complete release",
  cancel: "Cancel release",
};

const ACTIONS: ReleaseAction[] = ["book", "stage", "complete", "cancel"];

function legalActions(status: ReleaseStatus): ReleaseAction[] {
  return ACTIONS.filter((action) => releaseActionAllowed(action, status));
}

function HoldLabel(): JSX.Element {
  return (
    <span className="badge badge-alert">
      <Icon name="alert" size={16} />
      Held: unpaid invoice
    </span>
  );
}

export function Releases(): JSX.Element {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [note, say] = useNote();

  useEffect(() => {
    get<{ releases: Release[] }>("/api/releases", true).then((answer) => setReleases(answer.releases), () => undefined);
  }, []);

  usePoll(async () => {
    const fresh = (await get<{ releases: Release[] }>("/api/releases")).releases;
    if (JSON.stringify(fresh) === JSON.stringify(releases)) return;
    applyInPlace(
      () => setReleases(fresh),
      (row) => {
        const cells = row ? document.querySelector(`[data-row="${CSS.escape(row)}"]`) : null;
        return cells?.querySelector<HTMLElement>("button") ?? cells?.querySelector<HTMLElement>("[data-car-cell]") ?? null;
      },
    );
  }, 10_000);

  const run = async (release: Release, action: ReleaseAction): Promise<void> => {
    say("Saving...");
    try {
      const answer = await request<{ release: Release }>(`/api/releases/${release.id}/${action}`, { method: "POST" });
      const next = answer.data.release;
      setReleases((current) => (current ?? []).map((entry) => (entry.id === next.id ? next : entry)));
      if (action === "book") say(`Release booked for ${next.car.name}, ${next.slot_label}. The owner will be emailed.`);
      if (action === "stage") say(`${next.car.name} staged for handover.`);
      if (action === "complete") say(`${next.car.name} released. Bay ${release.bay_code ?? ""} is free.`);
      if (action === "cancel") say("Release cancelled.");
    } catch (error) {
      say(releaseError(error), "error");
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Releases</h1>
        <StatusRegion name="Release updates" note={note} />
      </header>
      <table aria-label="Releases" className="table releases-table">
        <thead>
          <tr>
            <th scope="col">Car</th>
            <th scope="col" className="hide-narrow">
              Owner
            </th>
            <th scope="col">Slot</th>
            <th scope="col">Status</th>
            <th scope="col" className="hide-narrow">
              Bay
            </th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(releases ?? []).map((release) => {
            const held = OPEN_RELEASE.includes(release.status) && release.held_by.length > 0;
            return (
              <tr key={release.id} data-row={release.id} className={release.status === "staged" ? "taped" : undefined}>
                <td data-car-cell tabIndex={-1}>
                  {release.car.name}
                </td>
                <td className="hide-narrow">{release.owner.name}</td>
                <td className="mono-text">{release.slot_label}</td>
                <td>
                  {RELEASE_STATUS_LABEL[release.status]}
                  {held ? <HoldLabel /> : null}
                </td>
                <td className="hide-narrow mono-text">{release.bay_code ?? "—"}</td>
                <td>
                  <div className="row-actions">
                  {legalActions(release.status).map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={action === "cancel" ? "button small" : "button small primary"}
                      onClick={() => void run(release, action)}
                    >
                      {ACTION_LABEL[action]}
                    </button>
                  ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {releases && releases.length === 0 ? (
        <p className="empty empty-drawn">
          <Icon name="fileCheck" size={32} />
          No releases requested.
        </p>
      ) : null}
    </div>
  );
}

function releaseError(error: unknown): string {
  const code = errorCode(error);
  if (error instanceof HttpError && code === "invoice_unpaid" && "invoices" in error.body) {
    const numbers = (error.body.invoices ?? []).map((hold: Hold) => hold.number).join(", ");
    return `Invoice ${numbers} is unpaid. Record the payment before release.`;
  }
  if (error instanceof HttpError && code === "belongings_checked_in" && "items" in error.body) {
    const labels = (error.body.items ?? []).map((item: Item) => item.label).join(", ");
    return `Check out every item first: ${labels}.`;
  }
  if (code === "mail_unavailable") return "Email is unreachable, so the release was not completed. Nothing has changed.";
  if (code === "invalid_transition") return "This release has moved on. Reload to see its current state.";
  if (error instanceof Interrupted) return SIGNED_IN_AGAIN;
  if (error instanceof NoAnswer) return "No answer from the server. Nothing has changed; press again.";
  return "Nothing has changed.";
}
