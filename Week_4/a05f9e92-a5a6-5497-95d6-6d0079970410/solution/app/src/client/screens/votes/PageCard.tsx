import { Link, navigate } from "../../lib/router.js";
import { Modal } from "../../lib/dialog.js";
import { Button, StatusBlock } from "../../lib/ui.js";
import type { PageJson } from "../../../server/oncall.js";
import { useCardGesture } from "./gesture.js";
import { formatLocalIso } from "../../../shared/tz.js";

const STATUS_WORD: Record<PageJson["status"], string> = { paging: "Paging", acknowledged: "Acknowledged", exhausted: "Exhausted" };

/** A page card. On a phone a swipe right acknowledges (after the Undo period) and a long press opens the actions sheet. */
export function PageCard({
  page,
  names,
  zone,
  phone,
  error,
  busy,
  onAcknowledge,
  onSwipe,
  onSheet,
}: {
  page: PageJson;
  names: ReadonlyMap<string, string>;
  zone: string;
  phone: boolean;
  error: string | undefined;
  busy: boolean;
  onAcknowledge(): void;
  onSwipe(): void;
  onSheet(): void;
}): JSX.Element {
  const gesture = useCardGesture({ enabled: phone && page.status !== "acknowledged", directions: ["right"], onSwipe, onLongPress: onSheet });
  const who = (username: string): string => names.get(username) ?? username;
  return (
    <article aria-label={`Page for ${page.record}`} className="page-card" tabIndex={-1} data-card={page.id} data-press="" {...gesture}>
      <div className="vote-head">
        <p className="vote-number">
          <Link to={`/desk/records/${page.record}`} className="page-card-record">
            {page.record}
          </Link>
        </p>
        <span className="page-status">
          <StatusBlock outlined={page.status === "acknowledged"}>{STATUS_WORD[page.status]}</StatusBlock>
          {page.late ? <StatusBlock>Late</StatusBlock> : null}
        </span>
      </div>
      <h3 className="page-level">
        {page.status === "acknowledged" ? `Acknowledged at level ${page.acknowledged_level}` : page.status === "exhausted" ? `Not acknowledged after level ${page.level}` : `Now at level ${page.level}`}
      </h3>
      <ol className="page-levels">
        {page.levels.map((entry) => (
          <li key={entry.level}>
            <span className="page-who">
              Level {entry.level}: {who(entry.username)}
            </span>
            <span className="muted">
              Notified {formatLocalIso(entry.notified_at, zone)}
              {page.status === "paging" && entry.level === page.level ? `, acknowledge by ${formatLocalIso(entry.ack_due_at, zone)}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {page.acknowledged_by ? <p className="page-acked">Acknowledged by {who(page.acknowledged_by)}.</p> : null}
      {page.status === "acknowledged" ? null : (
        <div className="vote-actions">
          <Button busy={busy} onClick={onAcknowledge}>
            Acknowledge
          </Button>
        </div>
      )}
      {error ? <p className="form-error vote-error">{error}</p> : null}
    </article>
  );
}

export function PageSheet({ page, onClose, onAcknowledge }: { page: PageJson; onClose(): void; onAcknowledge(): void }): JSX.Element {
  return (
    <Modal label="Page actions" sheet onClose={onClose} className="votes-sheet">
      <p className="sheet-title">Page for {page.record}</p>
      <div className="sheet-actions">
        <Button
          onClick={() => {
            onClose();
            onAcknowledge();
          }}
        >
          Acknowledge
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onClose();
            navigate(`/desk/records/${page.record}`);
          }}
        >
          Open incident
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
