import { useId, useState, type ReactNode } from "react";
import type { CardDerivative, LibraryCard } from "../../shared/api.ts";
import { api, messageOf } from "../lib/api.ts";
import { calendarDate, timeOf } from "../lib/format.ts";
import { Alert, Badge, Button } from "../ui/index.ts";

interface IssuedLink {
  url: string;
  expiresAt: string;
}

function startDownload(url: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

interface CardViewProps {
  card: LibraryCard;
  /** Agency partners get `Request use`. */
  agency: boolean;
  onRequest: (card: LibraryCard, opener: HTMLButtonElement) => void;
}

/** A button that stays focusable while unavailable and carries its reason as its accessible description. */
function UnavailableButton({ label, describedBy, primary = false }: { label: string; describedBy: string; primary?: boolean }): ReactNode {
  return (
    <button type="button" className={`btn${primary ? " btn-primary" : ""}`} aria-disabled="true" aria-describedby={describedBy} onClick={(event) => event.preventDefault()}>
      {label}
    </button>
  );
}

export function CardView({ card, agency, onRequest }: CardViewProps): ReactNode {
  const reasonId = useId();
  const requestReasonId = useId();
  const [links, setLinks] = useState<Record<string, IssuedLink>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue(derivative: CardDerivative): Promise<void> {
    setPending(derivative.id);
    setError(null);
    try {
      const link = await api<IssuedLink>("POST", `/api/derivatives/${derivative.id}/link`);
      setLinks((current) => ({ ...current, [derivative.id]: link }));
      startDownload(link.url, derivative.fileName);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setPending(null);
    }
  }

  const available = card.badge === "Available";
  const requestDescription = card.requestReason ? requestReasonId : reasonId;

  return (
    <article className="cell cell-pad lib-card" aria-label={`${card.cardName}, ${card.badge}`} data-frame>
      <div className="lib-card-head">
        <h2>{card.cardName}</h2>
        <Badge word={card.badge} />
      </div>
      <p className="muted">{card.classLabel}</p>
      <p className="muted">{card.licenceName}</p>

      {!available && card.reason ? (
        <p id={reasonId} className="lib-reason">
          {card.reason}
        </p>
      ) : null}

      <div className="lib-actions">
        {available ? (
          card.derivatives.map((derivative) => (
            <div key={derivative.id} className="lib-download">
              <Button pending={pending === derivative.id && "save"} disabled={pending !== null} onClick={() => void issue(derivative)}>
                {`Download ${derivative.fileName}`}
              </Button>
              {links[derivative.id] ? (
                <p className="lib-link">
                  <span>{`Link expires at ${timeOf(links[derivative.id].expiresAt)}`}</span>
                  <a href={links[derivative.id].url} download={derivative.fileName}>{`Download again: ${derivative.fileName}`}</a>
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <UnavailableButton label="Download" describedBy={reasonId} />
        )}
        {agency && card.badge === "Request required" ? (
          card.canRequest ? (
            <Button primary onClick={(event) => onRequest(card, event.currentTarget)}>
              Request use
            </Button>
          ) : (
            <>
              <UnavailableButton label="Request use" describedBy={requestDescription} primary />
              {card.requestReason ? (
                <p id={requestReasonId} className="lib-reason">
                  {card.requestReason}
                </p>
              ) : null}
            </>
          )
        ) : null}
      </div>
      <Alert message={error} />

      {card.grant ? (
        <div className="lib-grant">
          <p>
            <strong>{`Grant ${card.grant.id}`}</strong>
            {` · ${card.grant.statusLabel} · Ends ${calendarDate(card.grant.notAfter)}`}
          </p>
          {card.grant.conditions.length > 0 ? (
            <ul>
              {card.grant.conditions.map((condition) => (
                <li key={condition.text}>{condition.text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
