import { useLayoutEffect, useRef } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { BANNERS, useDeck } from "./deck";
import { Field } from "./field";
import { EASE, SCREEN_SLIDE_MS, SCREEN_SLIDE_PX, prefersReducedMotion } from "./motion";
import { CaptureScreen } from "./screens/capture";
import { FactsScreen } from "./screens/facts";
import { LandingScreen } from "./screens/landing";
import { LibraryScreen } from "./screens/library";
import { NotFoundScreen } from "./screens/not-found";
import { ReelScreen } from "./screens/reel";
import { ReelsScreen } from "./screens/reels";
import { SettingsScreen } from "./screens/settings";
import { TrashScreen } from "./screens/trash";

const NAV = [
  { to: "/library", label: "Library" },
  { to: "/capture", label: "Capture" },
  { to: "/reels", label: "Reels" },
  { to: "/trash", label: "Trash" },
  { to: "/settings", label: "Settings" },
] as const;

/** Reference facts count as Library and Reel counts as Reels. */
function sectionOf(pathname: string): number {
  const section = NAV.findIndex(({ to }) => pathname === to || pathname.startsWith(`${to}/`));
  if (section >= 0) return section;
  return pathname.startsWith("/references/") ? 0 : -1;
}

function Dock() {
  const { message, services } = useDeck();
  const down = (Object.keys(BANNERS) as (keyof typeof BANNERS)[]).filter((name) => services?.[name] === "down");
  return (
    <div className="dock">
      <div role="status" aria-label="Service notices" className="notices">
        {down.map((name) => (
          <p key={name}>{BANNERS[name]}</p>
        ))}
      </div>
      <div role="status" aria-label="Deck status" className={`deck-status${message ? " has-message" : ""}`}>
        {message}
      </div>
    </div>
  );
}

export function Shell() {
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  const slide = useRef(0);
  const landing = location.pathname === "/";
  const here = sectionOf(location.pathname);

  useLayoutEffect(() => {
    const direction = slide.current;
    slide.current = 0;
    if (direction === 0 || prefersReducedMotion()) return;
    main.current?.getAnimations().forEach((animation) => animation.cancel());
    main.current?.animate(
      [
        { transform: `translateX(${direction * SCREEN_SLIDE_PX}px)`, opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      // Fill forwards at rest (transform none) so the finished slide stays inspectable until the next
      // screen change cancels it; a short slide on a busy machine otherwise vanishes before it is read.
      { duration: SCREEN_SLIDE_MS, easing: EASE, fill: "forwards" },
    );
  }, [location.key]);

  return (
    <div className={`shell${landing ? " landing" : ""}`}>
      <div className="text-column">
        {!landing && (
          <nav aria-label="Deck" className="deck-nav">
            {NAV.map(({ to, label }, index) => (
              <Link
                key={to}
                to={to}
                aria-current={here === index ? "page" : undefined}
                onClick={() => {
                  slide.current = index >= here ? 1 : -1;
                }}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        <Dock />
        <main ref={main}>
          <Routes>
            <Route path="/" element={<LandingScreen />} />
            <Route path="/library" element={<LibraryScreen />} />
            <Route path="/capture" element={<CaptureScreen />} />
            <Route path="/reels" element={<ReelsScreen />} />
            <Route path="/reels/:id" element={<ReelScreen />} />
            <Route path="/references/:id" element={<FactsScreen />} />
            <Route path="/trash" element={<TrashScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        </main>
      </div>
      <Field />
    </div>
  );
}
