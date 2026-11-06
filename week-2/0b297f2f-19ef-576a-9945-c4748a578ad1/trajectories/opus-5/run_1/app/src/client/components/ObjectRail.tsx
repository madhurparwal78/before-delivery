import { useRef, type ReactElement } from 'react';
import { announce as copy, COLLECTION_NAME } from '../../shared/copy';
import type { LoanObject, Placement } from '../../shared/types';
import { formatDimensions, formatLux } from '../../shared/units';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';
import { PendingMark } from './common';

function statusText(placement: Placement | undefined): string {
  if (!placement) return 'Not placed';
  switch (placement.status) {
    case 'proposed':
      return 'Proposed';
    case 'claimed':
      return `Claimed by ${placement.claimedBy?.name ?? ''}`;
    case 'hung':
      return 'Hung';
    case 'signed_off':
      return 'Signed off';
    default:
      return 'Not placed';
  }
}

function photoCountText(count: number): string {
  if (count === 0) return 'No condition photo';
  if (count === 1) return '1 condition photo';
  return `${count} condition photos`;
}

export interface ObjectRailProps {
  onPlace: (object: LoanObject) => void;
}

export function ObjectRail({ onPlace }: ObjectRailProps): ReactElement {
  const app = useApp();
  const { objects, placements, staff, unit, uploadingPhotos, pendingClaims } = app;
  const fileInputs = useRef<Map<string, HTMLInputElement>>(new Map());

  return (
    <section className="object-rail" aria-label="Objects">
      <ul className="object-list" aria-label="Objects">
        {objects.map((object) => {
          const placement = placements.find((item) => item.objectId === object.id);
          const isHolder = placement?.claimedBy?.id === staff?.id;
          const uploading = uploadingPhotos.includes(object.id);
          const claimPending = placement ? pendingClaims.includes(placement.id) : false;
          return (
            <li
              key={object.id}
              className="object-card"
              aria-labelledby={focusIds.cardTitle(object.id)}
            >
              <h3 id={focusIds.cardTitle(object.id)} tabIndex={-1}>
                {object.title}
              </h3>
              <p className="card-number">{object.objectNumber}</p>
              <p className="card-lender">{object.lenderName ?? COLLECTION_NAME}</p>
              <p className="card-dimensions">
                {formatDimensions(object.widthMm, object.heightMm, unit)}
              </p>
              <p className="card-lux">{formatLux(object.luxLimit)}</p>
              <p className="card-status">{statusText(placement)}</p>
              <p className="card-photos">
                {uploading ? copy.uploadingPhoto : photoCountText(object.photos.length)}
              </p>
              <div className="card-actions">
                {staff?.role === 'curator' && !placement ? (
                  <button
                    type="button"
                    id={focusIds.cardAction(object.id, 'place')}
                    onClick={() => onPlace(object)}
                  >
                    Place
                  </button>
                ) : null}
                {staff?.role === 'preparator' && placement?.status === 'proposed' ? (
                  <button
                    type="button"
                    id={focusIds.cardAction(object.id, 'claim')}
                    onClick={() => void app.claim(placement.id)}
                    aria-disabled={claimPending}
                  >
                    Claim
                    {claimPending ? <PendingMark /> : null}
                  </button>
                ) : null}
                {staff?.role === 'preparator' && placement?.status === 'claimed' && isHolder ? (
                  <>
                    <button
                      type="button"
                      id={focusIds.cardAction(object.id, 'release')}
                      onClick={() => void app.release(placement.id)}
                    >
                      Release
                    </button>
                    <button
                      type="button"
                      id={focusIds.cardAction(object.id, 'hang')}
                      onClick={() => void app.markHung(placement.id)}
                    >
                      Mark hung
                    </button>
                  </>
                ) : null}
                {staff?.role === 'registrar' && placement?.status === 'hung' ? (
                  <button
                    type="button"
                    id={focusIds.cardAction(object.id, 'signoff')}
                    onClick={() => void app.signOff(placement.id)}
                  >
                    Sign off
                  </button>
                ) : null}
              </div>
              {staff?.role === 'registrar' ? (
                <label className="card-photo-input">
                  <span>{`Condition photo for ${object.title}`}</span>
                  <input
                    type="file"
                    id={focusIds.photoInput(object.id)}
                    accept="image/jpeg,image/png"
                    ref={(element) => {
                      if (element) fileInputs.current.set(object.id, element);
                      else fileInputs.current.delete(object.id);
                    }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void app.uploadPhoto(object.id, file);
                      event.target.value = '';
                    }}
                  />
                </label>
              ) : null}
              <a
                className="card-record-link"
                href={`/records/${object.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  app.navigate(`/records/${object.id}`);
                }}
              >
                Open record
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
