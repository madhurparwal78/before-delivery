import { useEffect, useRef, useState } from "react";

const KEY = "wayline.consent";

// The consent card: Wayline stores no analytics identifier, so the card only explains and can be dismissed.
export default function Consent() {
  const [shown, setShown] = useState(true);
  const [details, setDetails] = useState(false);
  const card = useRef(null);
  useEffect(() => {
    if (window.localStorage.getItem(KEY) === "dismissed") setShown(false);
  }, []);
  // While the card floats over the page, scrolling keeps controls clear of it.
  useEffect(() => {
    if (!shown) return undefined;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingBottom = `${card.current.offsetHeight + 32}px`;
    });
    observer.observe(card.current);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, [shown]);
  if (!shown) return null;
  const dismiss = () => {
    window.localStorage.setItem(KEY, "dismissed");
    setShown(false);
  };
  return (
    <section ref={card} className="consent" aria-label="Cookie consent">
      <h2 className="sr-only">Cookie consent</h2>
      <p>No analytics or ad cookies here, only your console session.</p>
      {details && (
        <p className="consent-prefs" id="consent-details">
          Essential storage: your console session and this choice. Analytics: none, before or after consent.
        </p>
      )}
      <div className="consent-actions">
        <button type="button" className="btn btn-outline" aria-expanded={details} onClick={() => setDetails(!details)}>
          Manage preferences
        </button>
        <button type="button" className="btn btn-primary" onClick={dismiss}>Dismiss</button>
      </div>
    </section>
  );
}
