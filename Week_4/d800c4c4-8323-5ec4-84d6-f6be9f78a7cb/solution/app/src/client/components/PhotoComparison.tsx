import { useState } from "preact/hooks";
import type { Photo } from "../api";
import { bytes, libraryStamp } from "../format";
import { Num } from "./ui";

const SLOTS = [
  { event: "checkout", label: "Checkout photo", empty: "No checkout photo — this loan predates photos." },
  { event: "checkin", label: "Check-in photo", empty: "No check-in photo yet." },
] as const;

/** Checkout and check-in photos side by side (stacked on phones), each with capture time, size and fingerprint. */
export function PhotoComparison({ photos }: { photos: Photo[] }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  return (
    <section class="photo-compare" aria-label="Photo comparison">
      {SLOTS.map((slot) => {
        const photo = photos.find((p) => p.event === slot.event);
        return (
          <figure class="photo-slot" key={slot.event}>
            <figcaption class="slot-title">{slot.label}</figcaption>
            {photo ? (
              <div class="photo-body" key={photo.id}>
                {failed.has(photo.id) ? (
                  <p class="photo-missing">Photo storage is down. Photos will show again when it is back.</p>
                ) : (
                  <img
                    src={photo.url}
                    alt={`${slot.label}, captured ${libraryStamp(photo.captured_at)}`}
                    onError={() => setFailed((now) => new Set(now).add(photo.id))}
                  />
                )}
                <p class="photo-meta">
                  Captured <Num>{libraryStamp(photo.captured_at)}</Num> · <Num>{bytes(photo.byte_size)}</Num>
                </p>
                <p class="photo-hash">
                  <Num>{photo.sha256}</Num>
                </p>
                <a href={photo.url} target="_blank" rel="noopener">
                  Open original
                </a>
              </div>
            ) : (
              <p class="photo-empty">{slot.empty}</p>
            )}
          </figure>
        );
      })}
    </section>
  );
}
