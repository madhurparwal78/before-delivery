import { useEffect, useState } from "react";
import { useShop } from "../state/shop";

/** The hold countdown, ticking each second from the server's expiry adjusted for clock skew. */
export function HoldTimer({ className = "" }: { className?: string }) {
  const { cart, clockOffset } = useShop();
  const expires = cart?.hold.status === "active" && cart.hold.expires_at ? Date.parse(cart.hold.expires_at) : null;
  const left = () => (expires === null ? 0 : Math.max(0, Math.ceil((expires - (Date.now() + clockOffset)) / 1000)));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    const tick = setInterval(() => setSeconds(left()), 1000);
    return () => clearInterval(tick);
  }, [expires, clockOffset]);
  if (expires === null) return null;
  const text = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <p className={`hold ${className}`}>
      <span>Cans held for</span>{" "}
      <span role="timer" aria-label="Hold time left" className="num hold-time">
        {text}
      </span>
    </p>
  );
}
