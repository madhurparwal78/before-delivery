import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Sticker, type StickerKind } from "./Sticker";

/** Outage and billing banners: a blush card with an ink Lucide icon and the exact copy. */
export function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="banner" role="alert">
      <Icon name="alert" />
      <p>{children}</p>
    </div>
  );
}

/** Empty state: one centred Parkinsans line with a cropped sticker. */
export function Empty({ text, sticker = "cube" }: { text: string; sticker?: StickerKind }) {
  return (
    <div className="empty">
      <Sticker kind={sticker} tilt={-6} className="empty-sticker" />
      <p className="empty-line">{text}</p>
    </div>
  );
}

/** Loading: sticker-shaped flat blocks that pass a lighter band once, then stay still. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      <span className="skeleton-coin" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton-bar" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  );
}

/** A live region showing only its latest message. */
export function Status({ label, message, className = "" }: { label: string; message: string; className?: string }) {
  return (
    <p className={`status-line ${className}`} role="status" aria-live="polite" aria-label={label}>
      {message}
    </p>
  );
}

/** A table that scrolls sideways inside its card on narrow screens; focusable so a keyboard can scroll it. */
export function TableScroll({ label, labelledBy, children }: { label?: string; labelledBy?: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" tabIndex={0} aria-label={label} aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}

