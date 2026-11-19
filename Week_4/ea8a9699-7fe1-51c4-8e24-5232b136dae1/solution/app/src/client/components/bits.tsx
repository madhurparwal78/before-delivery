// Small shared pieces: state tags with icons, media thumbnails, the rolling count, the empty mark.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Ban,
  Check,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleSlash,
  Clock,
  ClockAlert,
  Eye,
  Globe,
  PencilLine,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { LinkState, Status } from "../../shared/api.js";
import { EASE, MS, reducedMotion } from "../lib/motion.js";

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  in_review: "In review",
  embargoed: "Embargoed",
  public: "Public",
  withdrawn: "Withdrawn",
};

const STATUS_ICON: Record<Status, LucideIcon> = { draft: PencilLine, in_review: Eye, embargoed: Clock, public: Globe, withdrawn: Archive };

const LINK_LABEL: Record<LinkState, string> = { live: "Live", expired: "Expired", revoked: "Revoked", inactive: "Inactive" };
const LINK_ICON: Record<LinkState, LucideIcon> = { live: CircleDot, expired: ClockAlert, revoked: Ban, inactive: CirclePause };

export type SeatTag = "Seats free" | "Full" | "Over cap";
const SEAT_ICON: Record<SeatTag, LucideIcon> = { "Seats free": CircleCheck, Full: CircleSlash, "Over cap": TriangleAlert };

/** A word with its icon; colour is never the only signal (brief: Visual design > Never colour alone). */
function Tag({ icon: Icon, children, tone }: { icon: LucideIcon; children: ReactNode; tone?: string }) {
  return (
    <span className="tag" data-tone={tone}>
      <Icon size={14} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export const StatusTag = ({ status }: { status: Status }) => (
  <Tag icon={STATUS_ICON[status]} tone={status}>
    {STATUS_LABEL[status]}
  </Tag>
);

export const LinkTag = ({ state }: { state: LinkState }) => (
  <Tag icon={LINK_ICON[state]} tone={state}>
    {LINK_LABEL[state]}
  </Tag>
);

export const SeatStateTag = ({ tag }: { tag: SeatTag }) => (
  <Tag icon={SEAT_ICON[tag]} tone={tag === "Seats free" ? "free" : "full"}>
    {tag}
  </Tag>
);

export const MemberSeatTag = ({ seated }: { seated: boolean }) => (
  <Tag icon={seated ? CircleCheck : CirclePause} tone={seated ? "seated" : "unseated"}>
    {seated ? "Seated" : "No seat"}
  </Tag>
);

export const PlanMark =({ children }: { children: ReactNode }) => (
  <p className="plan-current">
    <Check size={16} aria-hidden="true" />
    {children}
  </p>
);

/** Three dots while a request is in flight: the only loop in the app. */
export const Pending = () => (
  <span className="pending" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>
);

const RETRY_MS = 10_000;

/**
 * A reference's picture. When the image cannot load (storage down) the card shows "Preview unavailable" and
 * retries every 10 s, so previews come back by themselves once storage returns.
 */
export function Thumb({ src, kind, alt, className = "", cover = false }: { src: string; kind: "image" | "clip" | "still"; alt: string; className?: string; cover?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((n) => n + 1);
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failed]);
  if (cover) className = `${className} thumb--cover`;
  else if (kind === "clip") className = `${className} thumb--clip`;
  if (failed) {
    return (
      <div className={`thumb thumb--missing ${className}`}>
        <span>Preview unavailable</span>
      </div>
    );
  }
  if (kind === "clip") {
    return <video key={attempt} className={`thumb ${className}`} src={`${src}#t=0.1`} muted playsInline preload="metadata" aria-label={alt} onError={() => setFailed(true)} />;
  }
  return <img key={attempt} className={`thumb ${className}`} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

/** "<n> items" whose digits roll when the number changes (brief: Motion > count roll); in place under reduced motion. */
export function RollingNumber({ value }: { value: number }) {
  const previous = useRef(value);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const incoming = useRef<HTMLSpanElement | null>(null);
  const leaving = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    const old = previous.current;
    previous.current = value;
    if (!reducedMotion()) setOutgoing(old);
  }, [value]);
  useLayoutEffect(() => {
    if (outgoing === null) return;
    const up = outgoing < value;
    incoming.current?.animate([{ transform: `translateY(${up ? 100 : -100}%)` }, { transform: "translateY(0)" }], { duration: MS.roll, easing: EASE });
    const out = leaving.current?.animate([{ transform: "translateY(0)" }, { transform: `translateY(${up ? -100 : 100}%)` }], { duration: MS.roll, easing: EASE, fill: "forwards" });
    if (!out) return setOutgoing(null);
    out.onfinish = () => setOutgoing(null);
    out.oncancel = () => setOutgoing(null);
  }, [outgoing, value]);
  return (
    <span className="roll">
      <span ref={incoming} className="roll__digits">
        {value}
      </span>
      {outgoing !== null && (
        <span ref={leaving} className="roll__digits roll__digits--out" aria-hidden="true">
          {outgoing}
        </span>
      )}
    </span>
  );
}

/** Drawn film-frame mark for empty states. */
export const EmptyMark = () => (
  <svg className="empty-mark" width="48" height="40" viewBox="0 0 48 40" aria-hidden="true">
    <rect x="1" y="1" width="46" height="38" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {[6, 16, 26, 36].map((x) => (
      <g key={x}>
        <rect x={x} y="4" width="5" height="3" rx="1" fill="currentColor" />
        <rect x={x} y="33" width="5" height="3" rx="1" fill="currentColor" />
      </g>
    ))}
    <rect x="8" y="11" width="32" height="18" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** "<source clip title> · <timecode>": a long clip title is cut short, the timecode never is. */
export function StillSource({ clipTitle, timecode, className }: { clipTitle: string; timecode: string; className: string }) {
  return (
    <span className={`still-source mono ${className}`}>
      <span className="still-source__lead">
        <span className="still-source__clip">{clipTitle}</span> ·
      </span>{" "}
      <span className="still-source__tc">{timecode}</span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <EmptyMark />
      <p>{children}</p>
    </div>
  );
}


/** "YYYY-MM-DD HH:MM" in UTC, the form every instant takes on screen. */
export const utcMinute = (iso: string): string => iso.slice(0, 16).replace("T", " ");
