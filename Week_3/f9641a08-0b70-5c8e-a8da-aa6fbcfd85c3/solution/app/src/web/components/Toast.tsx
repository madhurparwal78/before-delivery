import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { EASE, MOTION, reducedNow, useMotionMs } from "../lib/motion";
import { announce, applyCart, useApp } from "../lib/store";
import type { Cart } from "../../shared/api";

// The visual mirror of status "Cart updates". It hides after the toast time, or after the undo time
// when it carries Undo, counted on the page clock.

export function Toast() {
  const { announcement, config } = useApp();
  const [shown, setShown] = useState<number | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const motionMs = useMotionMs(MOTION.toast);

  useEffect(() => {
    if (!announcement || !config) return;
    setShown(announcement.id);
    const seconds = announcement.undo ? config.cart_undo_seconds : config.toast_seconds;
    const timer = window.setTimeout(() => setShown((current) => (current === announcement.id ? null : current)), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [announcement, config]);

  useEffect(() => {
    if (shown === null || reducedNow()) return;
    element.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.toast, easing: EASE });
  }, [shown]);

  if (!announcement || shown !== announcement.id) return null;
  const { undo } = announcement;

  const restore = async () => {
    if (!undo) return;
    const cart = await api.post<Cart>("/api/cart/lines", { sku: undo.sku, quantity: undo.quantity });
    applyCart(cart);
    announce(`Restored ${undo.product}.`);
  };

  return (
    <div ref={element} className="toast" data-motion-ms={motionMs}>
      <span aria-hidden="true">{announcement.text}</span>
      {undo && (
        <button type="button" onClick={() => void restore()}>
          Undo
        </button>
      )}
    </div>
  );
}
