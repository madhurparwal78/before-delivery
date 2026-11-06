import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { initials } from "../format";
import { EASE_OUT, reducedMotion } from "../motion";
import type { Member } from "../types";
import type { Band } from "./layout";

const TINTS = ["#7F95C4", "#8FB08C", "#CF959D", "#AB9DD6", "#8CA3B3", "#93A160", "#C98F6C"];
const FLIGHT_MS = 320;
const ARC_PX = 16;

export function tintOf(participants: Member[], userId: string | null): string {
  const index = participants.findIndex((p) => p.user_id === userId);
  return TINTS[(index < 0 ? 0 : index) % TINTS.length]!;
}

type PresenceWord = "driving" | "viewing" | "offline";

function presenceOf(member: Member, driverId: string | null): PresenceWord {
  if (member.user_id === driverId) return "driving";
  return member.online ? "viewing" : "offline";
}

interface RailProps {
  participants: Member[];
  me: string;
  driverId: string | null;
  following: string | null;
  band: Band;
  onFollow: (userId: string) => void;
  /** Called when the baton lands: the rings, stripe and carets switch from here on. */
  onLanded: (driverId: string | null, previous: string | null) => void;
}

function centre(container: HTMLElement, userId: string): { x: number; y: number } | null {
  const avatar = container.querySelector<HTMLElement>(`[data-user="${userId}"] .avatar`);
  if (!avatar) return null;
  const box = container.getBoundingClientRect();
  const target = avatar.getBoundingClientRect();
  return {
    x: target.left - box.left + container.scrollLeft + target.width / 2,
    y: target.top - box.top + container.scrollTop + target.height / 2,
  };
}

export function Rail({ participants, me, driverId, following, band, onFollow, onLanded }: RailProps) {
  const list = useRef<HTMLDivElement>(null);
  const glyph = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | null | undefined>(undefined);
  const flight = useRef<Animation | null>(null);
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;
  const [ringDriver, setRingDriver] = useState<string | null>(driverId);
  const [sheetFor, setSheetFor] = useState<string | null>(null);

  useEffect(() => {
    if (!sheetFor) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.(`[data-user="${sheetFor}"]`)) setSheetFor(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [sheetFor]);

  // Baton Pass: runs synchronously when the server's new driver reaches the client (the socket handler flushes).
  useLayoutEffect(() => {
    const container = list.current;
    const first = previous.current === undefined;
    const from = previous.current ?? null;
    previous.current = driverId;
    if (first) landedRef.current(driverId, null);
    if (!container || !driverId || !glyph.current) {
      if (from !== driverId) {
        setRingDriver(driverId);
        landedRef.current(driverId, from);
      }
      return;
    }
    const element = glyph.current;
    const to = centre(container, driverId);
    if (!to) return;
    element.style.left = `${to.x - element.offsetWidth / 2}px`;
    element.style.top = `${to.y - element.offsetHeight / 2}px`;
    if (first || from === driverId) return;
    flight.current?.cancel();
    const start = from ? centre(container, from) : null;
    const land = () => {
      setRingDriver(driverId);
      landedRef.current(driverId, from);
    };
    if (!start || reducedMotion()) return land();
    const dx = start.x - to.x;
    const dy = start.y - to.y;
    const animation = element.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: `translate(${dx / 2}px, ${dy / 2 - ARC_PX}px)`, offset: 0.5 },
        { transform: "translate(0px, 0px)" },
      ],
      { duration: FLIGHT_MS, easing: EASE_OUT },
    );
    flight.current = animation;
    animation.finished.then(land, () => undefined);
  }, [driverId]);

  // Keep the resting glyph on its avatar when the rail reflows (presence changes, band changes, resizes).
  useLayoutEffect(() => {
    const container = list.current;
    if (!container || !driverId) return;
    const place = () => {
      const element = glyph.current;
      const to = centre(container, driverId);
      if (!element || !to || element.getAnimations().length) return;
      element.style.left = `${to.x - element.offsetWidth / 2}px`;
      element.style.top = `${to.y - element.offsetHeight / 2}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  }, [driverId, participants, band]);

  return (
    <aside className="rail" aria-label="Presence">
      <div ref={list} className="rail-stage">
      <ul className="rail-list" aria-label="Participants">
        {participants.map((member, index) => {
          const word = presenceOf(member, driverId);
          const self = member.user_id === me;
          const ring = member.user_id === ringDriver ? "ring-driver" : member.online ? "ring-online" : "ring-offline";
          const avatar = (
            <span
              className={`avatar ${ring}`}
              style={{ "--tint": TINTS[index % TINTS.length] } as React.CSSProperties}
              data-first={initials(member.name)[0]}
              data-second={initials(member.name).slice(1)}
              aria-hidden="true"
            />
          );
          const pressed = following === member.user_id;
          return (
            <li key={member.user_id} data-user={member.user_id} className={`rail-item rail-${word}`}>
              {self ? (
                <span className="avatar-hit">{avatar}</span>
              ) : band === "narrow" ? (
                <button
                  type="button"
                  className="avatar-hit"
                  aria-label={member.name}
                  aria-expanded={sheetFor === member.user_id}
                  onClick={() => setSheetFor((v) => (v === member.user_id ? null : member.user_id))}
                >
                  {avatar}
                </button>
              ) : (
                <button
                  type="button"
                  className={pressed ? "avatar-hit is-pressed" : "avatar-hit"}
                  aria-label={`Follow ${member.name}`}
                  aria-pressed={pressed}
                  onClick={() => onFollow(member.user_id)}
                >
                  {avatar}
                </button>
              )}
              <span className="rail-label">
                <span className="rail-name">
                  {member.name}
                  {self && " (you)"}
                </span>
                <span className="rail-word">{word}</span>
              </span>
              {member.role === "student" && member.email_status === "none" && <span className="demo-tag">demo</span>}
              {band === "narrow" && sheetFor === member.user_id && !self && (
                <div className="follow-sheet">
                  <button
                    type="button"
                    className={pressed ? "button button-quiet is-pressed" : "button button-quiet"}
                    aria-pressed={pressed}
                    onClick={() => {
                      onFollow(member.user_id);
                      setSheetFor(null);
                    }}
                  >
                    Follow {member.name}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {driverId && (
        <span ref={glyph} className="baton" role="img" aria-label="Baton">
          <svg width="4" height="14" viewBox="0 0 4 14" aria-hidden="true" focusable="false">
            <rect width="4" height="14" rx="2" />
          </svg>
        </span>
      )}
      </div>
    </aside>
  );
}
