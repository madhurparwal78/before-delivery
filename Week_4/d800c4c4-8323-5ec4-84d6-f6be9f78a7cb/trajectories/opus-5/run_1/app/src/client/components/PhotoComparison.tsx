import { useState } from 'react';
import { EMPTY_CHECKIN_SLOT, EMPTY_CHECKOUT_SLOT, PHOTO_LOAD_FAILED } from '../../shared/copy';
import type { Photo, PhotoEvent } from '../../shared/types';

const SLOT_LABELS: Record<PhotoEvent, string> = {
  checkout: 'Checkout photo',
  checkin: 'Check-in photo',
};

const EMPTY_COPY: Record<PhotoEvent, string> = {
  checkout: EMPTY_CHECKOUT_SLOT,
  checkin: EMPTY_CHECKIN_SLOT,
};

/** Captured times print as library-local `YYYY-MM-DD HH:MM`. */
function captureTime(photo: Photo): string {
  return `${photo.captured_at.slice(0, 10)} ${photo.captured_at.slice(11, 16)}`;
}

function Slot({ event, photo }: { readonly event: PhotoEvent; readonly photo: Photo | null }) {
  const [loadFailed, setLoadFailed] = useState(false);
  if (!photo) {
    return (
      <div className={`photo-slot photo-slot-${event}`}>
        <p className="photo-empty">{EMPTY_COPY[event]}</p>
      </div>
    );
  }
  return (
    <div className={`photo-slot photo-slot-${event}`}>
      {loadFailed ? (
        <p className="photo-empty">{PHOTO_LOAD_FAILED}</p>
      ) : (
        <img
          key={photo.id}
          src={photo.url}
          alt={`${SLOT_LABELS[event]}, captured ${captureTime(photo)}`}
          onError={() => setLoadFailed(true)}
        />
      )}
      <p className="photo-facts">
        <span className="numerals">{captureTime(photo)}</span>
        <span className="numerals">{photo.byte_size} bytes</span>
        <span className="numerals photo-hash">{photo.sha256}</span>
      </p>
      <a href={photo.url} target="_blank" rel="noreferrer">
        Open original
      </a>
    </div>
  );
}

/**
 * The checkout slot comes first and the check-in slot second, side by side at
 * 768 and wider and stacked at 375. A photo already shown is never reloaded,
 * because each image is keyed by its photo id.
 */
export function PhotoComparison({ photos }: { readonly photos: readonly Photo[] }): JSX.Element {
  const checkout = photos.find((photo) => photo.event === 'checkout') ?? null;
  const checkin = photos.find((photo) => photo.event === 'checkin') ?? null;
  return (
    <section className="photo-comparison">
      <h2>Condition photos</h2>
      <div className="photo-slots">
        <Slot event="checkout" photo={checkout} />
        <Slot event="checkin" photo={checkin} />
      </div>
    </section>
  );
}
