import { useEffect, useRef, useState } from "react";
import type { Member, Session, User } from "../../shared/types";
import { tintFor, initialsOf } from "./state";
import { api, ApiCallError } from "../lib/api";

interface BatonPass {
  from: string | null;
  to: string;
}

export function PresenceRail({
  participants,
  user,
  session,
  isMentor,
  band,
  followTarget,
  setFollowTarget,
  batonPass,
  reduced,
}: {
  participants: Member[];
  user: User;
  session: Session | null;
  isMentor: boolean;
  band: "narrow" | "medium" | "wide";
  followTarget: string | null;
  setFollowTarget: (id: string | null) => void;
  batonPass: BatonPass | null;
  reduced: boolean;
}): React.ReactElement {
  const driverId = session?.state === "live" ? session.driver_id : null;
  const [claimPending, setClaimPending] = useState(false);
  const [batonStatus, setBatonStatus] = useState("");
  const [passMenuOpen, setPassMenuOpen] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const glyphRef = useRef<HTMLSpanElement | null>(null);
  const lastDriverRef = useRef<string | null | undefined>(undefined);
  const passBtnRef = useRef<HTMLButtonElement | null>(null);

  // Baton Pass: the glyph flies from the old driver's centre to the new one.
  useEffect(() => {
    if (!batonPass) return;
    const rail = railRef.current;
    const glyph = glyphRef.current;
    if (!rail || !glyph) return;
    const railRect = rail.getBoundingClientRect();
    const centreOf = (id: string | null): { x: number; y: number } | null => {
      if (!id) return null;
      const el = rail.querySelector<HTMLElement>(`[data-avatar-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - railRect.left + r.width / 2, y: r.top - railRect.top + r.height / 2 };
    };
    const to = centreOf(batonPass.to);
    if (!to) return;
    glyph.style.opacity = "1";
    glyph.style.transform = `translate(${to.x - 9}px, ${to.y - 9}px)`;
    if (reduced || !batonPass.from) {
      return;
    }
    const from = centreOf(batonPass.from);
    if (!from) return;
    const midX = (from.x + to.x) / 2;
    const midY = Math.min(from.y, to.y) - 26;
    glyph.style.transform = `translate(${from.x - 9}px, ${from.y - 9}px)`;
    const anim = glyph.animate(
      [
        { transform: `translate(${from.x - 9}px, ${from.y - 9}px)`, offset: 0 },
        { transform: `translate(${midX - 9}px, ${midY - 9}px)`, offset: 0.5 },
        { transform: `translate(${to.x - 9}px, ${to.y - 9}px)`, offset: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    anim.onfinish = () => {
      glyph.style.transform = `translate(${to.x - 9}px, ${to.y - 9}px)`;
    };
  }, [batonPass, reduced]);

  useEffect(() => {
    if (session?.state === "live" && session.driver_id && lastDriverRef.current !== session.driver_id) {
      const seenBefore = lastDriverRef.current !== undefined;
      lastDriverRef.current = session.driver_id;
      if (seenBefore) {
        const name = participants.find((p) => p.user_id === session.driver_id)?.name ?? "";
        setBatonStatus(`${name} is now driving`);
      }
    }
  }, [session, participants]);

  const takeBaton = async () => {
    if (!session || claimPending) return;
    setClaimPending(true);
    setBatonStatus("Claiming the baton…");
    try {
      await api<{ session: Session }>("POST", `/api/sessions/${session.id}/baton/claim`, {
        version: session.version,
      });
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "baton_taken") {
          setBatonStatus(`${String(err.extra["driver_name"] ?? "Someone")} took the baton first.`);
        } else if (err.code === "session_not_live") {
          setBatonStatus("The baton is only passed during a live session.");
        } else if (err.code === "already_driving") {
          setBatonStatus("You are already driving.");
        } else {
          setBatonStatus("Something went wrong. Try again.");
        }
      } else {
        setBatonStatus("Something went wrong. Try again.");
      }
    } finally {
      setClaimPending(false);
    }
  };

  const passTo = async (targetId: string) => {
    if (!session) return;
    try {
      await api<{ session: Session }>("POST", `/api/sessions/${session.id}/baton/pass`, {
        to_user_id: targetId,
        version: session.version,
      });
    } catch (err) {
      if (err instanceof ApiCallError && err.code === "baton_taken") {
        setBatonStatus(`${String(err.extra["driver_name"] ?? "Someone")} took the baton first.`);
      } else {
        setBatonStatus("Something went wrong. Try again.");
      }
    }
  };

  const canTake = session?.state === "live" && session.driver_id !== user.id;
  const canPass = session?.state === "live" && (session.driver_id === user.id || isMentor);
  const others = participants.filter((p) => p.user_id !== user.id);

  return (
    <nav className={`presence-rail band-${band}`} aria-label="Presence" ref={(n) => { railRef.current = n; }}>
      {driverId ? (
        <span ref={glyphRef} className="baton-glyph" role="img" aria-label="Baton" style={{ opacity: 0 }} />
      ) : null}
      <ul className="participants" aria-label="Participants">
        {participants.map((p, i) => {
          const driving = p.user_id === driverId;
          const state = driving ? "driving" : p.online ? "viewing" : "offline";
          const demo = p.name === "Robin Vale";
          return (
            <li key={p.user_id} className={`participant${driving ? " driving" : ""}${p.online ? " online" : ""}`}>
              <span className="avatar-hit" title={`${p.name} — ${state}`}>
                <span className="avatar" data-avatar-id={p.user_id} style={{ background: tintFor(i) }} aria-hidden="true">
                  {initialsOf(p.name)}
                </span>
              </span>
              <span className="participant-info">
                <span className="participant-name">{p.name}</span>
                {demo ? <span className="demo-tag mono">demo</span> : null}
                <span className="participant-state">{state}</span>
              </span>
              {p.user_id !== user.id ? (
                <button
                  className="follow-btn"
                  aria-pressed={followTarget === p.user_id}
                  aria-label={`Follow ${p.name}`}
                  onClick={() => setFollowTarget(followTarget === p.user_id ? null : p.user_id)}
                >
                  Follow
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="baton-actions">
        {canTake ? (
          <button onClick={() => void takeBaton()} disabled={claimPending}>
            Take the baton
          </button>
        ) : null}
        {canPass ? (
          <div className="pass-menu-wrap">
            <button
              ref={passBtnRef}
              aria-haspopup="menu"
              aria-expanded={passMenuOpen}
              onClick={() => setPassMenuOpen((v) => !v)}
            >
              Pass the baton
            </button>
            {passMenuOpen ? (
              <div role="menu" aria-label="Pass to" className="pass-menu">
                {others.map((o) => (
                  <button
                    key={o.user_id}
                    role="menuitem"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setPassMenuOpen(false);
                        passBtnRef.current?.focus();
                      }
                    }}
                    onClick={() => {
                      void passTo(o.user_id);
                      setPassMenuOpen(false);
                      passBtnRef.current?.focus();
                    }}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <span className="baton-status" role="status" aria-label="Baton status">
          {batonStatus}
        </span>
      </div>
    </nav>
  );
}
