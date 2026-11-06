// Idle sign-out: after 28 minutes without input, a two-minute countdown; at zero the browser signs out.
import { useEffect, useRef, useState } from "react";
import { api, quietly } from "../api";
import { Dialog } from "./Dialog";

const IDLE_MS = 28 * 60 * 1000;
const COUNTDOWN_MS = 2 * 60 * 1000;
const SPOKEN = [120, 60, 10];

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const sentence = (seconds: number) => `You will be signed out in ${clock(seconds)} to protect this console.`;

export function IdleGuard({ onExpire, setStatus }: { onExpire: () => void; setStatus: (text: string) => void }) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [left, setLeft] = useState(120);
  const lastInput = useRef(Date.now());
  const open = deadline !== null;
  const openRef = useRef(open);
  openRef.current = open;
  const rearm = useRef<() => void>(() => undefined);
  const statusRef = useRef(setStatus);
  statusRef.current = setStatus;

  // Timers sit on exact moments of the page clock, so the countdown keeps exact time through re-renders.
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const idle = Date.now() - lastInput.current;
        if (idle >= IDLE_MS) {
          setLeft(120);
          statusRef.current(sentence(120));
          setDeadline(lastInput.current + IDLE_MS + COUNTDOWN_MS);
        } else arm();
      }, Math.max(0, lastInput.current + IDLE_MS - Date.now()));
    };
    const onInput = () => {
      if (openRef.current) return;
      lastInput.current = Date.now();
      arm();
    };
    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
    for (const name of events) window.addEventListener(name, onInput, { passive: true, capture: true });
    rearm.current = arm;
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, onInput, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (deadline === null) return;
    const timers: number[] = [];
    const now = Date.now();
    for (let s = 119; s >= 0; s--) {
      timers.push(window.setTimeout(() => {
        setLeft(s);
        if (SPOKEN.includes(s)) setStatus(sentence(s));
        if (s === 0) onExpire();
      }, Math.max(0, deadline - s * 1000 - now)));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [deadline, onExpire, setStatus]);

  const stay = () => {
    quietly(api("/api/session/refresh", { method: "POST", body: {} }));
    lastInput.current = Date.now();
    setDeadline(null);
    setLeft(120);
    rearm.current();
  };

  if (!open) return null;
  return (
    <Dialog label="Session ending" onClose={() => undefined} onEscape={stay} initialFocus="button">
      <h2>Session ending</h2>
      <p>You will be signed out in <span className="num">{clock(left)}</span> to protect this console.</p>
      <div className="actions">
        <button type="button" className="primary" onClick={stay}>Stay signed in</button>
      </div>
    </Dialog>
  );
}
