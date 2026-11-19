/** The Home detail dialog: the grown view panel, price and area figures, status, and the Hold this home action. */
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicHold, PublicUnit } from "../../shared/api-types.js";
import { COPY } from "../../shared/copy.js";
import { BAND_LABEL, VIEW_LABEL, bedroomLabel, type Band, type ViewTag } from "../../shared/domain.js";
import { Modal } from "../dialogs.js";
import { PANEL_SIZES, dollars, groupedNumber, officeTime, viewSrcSet } from "../format.js";
import { Link } from "../router.js";

interface Props {
  readonly code: string;
  readonly unit: PublicUnit | null;
  readonly gone: boolean;
  readonly statusText: string;
  readonly syncing: boolean;
  readonly mine: PublicHold | null;
  readonly confirmation: PublicHold | null;
  readonly canHold: boolean;
  readonly revealed: boolean;
  readonly onClose: () => void;
  readonly onHold: (button: HTMLElement) => void;
  readonly restoreFocus: () => HTMLElement | null;
}

const floorOf = (code: string): string => code.replace(/[A-H]$/, "");

export const Detail = ({ code, unit, gone, statusText, syncing, mine, confirmation, canHold, revealed, onClose, onHold, restoreFocus }: Props): ReactNode => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    if (confirmation) headingRef.current?.focus();
  }, [confirmation]);

  useEffect(() => setPhotoFailed(false), [unit?.viewUrl]);

  const closeButton = (
    <button type="button" className="button icon-button" aria-label="Close" onClick={onClose}>
      <X size={22} aria-hidden="true" />
    </button>
  );

  if (confirmation) {
    return (
      <Modal label={`Home ${code}`} onClose={onClose} className="modal-detail modal-confirmed" restoreFocus={restoreFocus} initialFocus={() => headingRef.current}>
        <div className="confirmed-numeral" aria-hidden="true" data-numeral={code} />
        <div className="detail-top">{closeButton}</div>
        <h2 ref={headingRef} tabIndex={-1} className="confirmed-heading">
          {COPY.confirmedHeading}
        </h2>
        <p className="confirmed-line figures">Held until {officeTime(confirmation.endsAt)}.</p>
        <p className="status-line">
          <span>{statusText}</span>
          {syncing ? <span className="tag"> · {COPY.syncing}</span> : null}
        </p>
        <p>
          <Link to={`/holds/${confirmation.id}`} className="button">
            Open your hold
          </Link>
        </p>
      </Modal>
    );
  }

  const panelText = gone ? COPY.withdrawnPanel : unit && !unit.viewPhotographed ? COPY.noPhoto : photoFailed ? COPY.photoDown : null;
  return (
    <Modal label={`Home ${code}`} onClose={onClose} className="modal-detail" restoreFocus={restoreFocus}>
      <div className="detail-numeral" aria-hidden="true" data-numeral={floorOf(code)} />
      <div className="detail-body" style={{ opacity: revealed ? 1 : 0 }}>
        <div className="detail-top">
          <h2>Home {code}</h2>
          {closeButton}
        </div>
        <div className="view-panel" data-view-panel>
          {!gone && unit?.viewUrl && !photoFailed ? (
            <img src={unit.viewUrl} srcSet={viewSrcSet(unit.viewUrl)} sizes={PANEL_SIZES} alt={`View from ${code}`} draggable={false} onError={() => setPhotoFailed(true)} />
          ) : null}
          {panelText ? <p className="panel-text">{panelText}</p> : null}
        </div>
        {unit ? (
          <>
            <p className="detail-price figures">{dollars(unit.price)}</p>
            <p className="figures">
              {dollars(unit.pricePerM2)} per m² · {dollars(unit.pricePerSqft)} per sq ft
            </p>
            <ul className="facts">
              <li className="figures">
                {unit.areaM2} m² · {groupedNumber(unit.areaSqft)} sq ft
              </li>
              <li>{bedroomLabel(unit.bedrooms)}</li>
              <li className="figures">
                {unit.bearing}° {unit.facing}
              </li>
              <li>{VIEW_LABEL[unit.viewTag as ViewTag]}</li>
              <li>{BAND_LABEL[unit.band as Band]}</li>
            </ul>
            <p className="tag-line">{unit.viewPhotographed ? COPY.viewPhotographed : COPY.noViewPhotographed}</p>
          </>
        ) : (
          <div className="skeleton-block" aria-hidden="true" />
        )}
        <p className="status-line">
          <span>{statusText}</span>
          {syncing ? <span className="tag"> · {COPY.syncing}</span> : null}
        </p>
        <div className="detail-actions">
          {mine ? (
            <Link to={`/holds/${mine.id}`} className="button">
              Open your hold
            </Link>
          ) : (
            <button type="button" className="button primary" disabled={!canHold} onClick={(event) => onHold(event.currentTarget)}>
              Hold this home
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};
