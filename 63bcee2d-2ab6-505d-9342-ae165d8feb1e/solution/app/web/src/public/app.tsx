import { useLayoutEffect, useRef } from "react";
import { match, useLocation } from "../router";
import { CaseStudyPage } from "./casestudy";
import { markHeadingFocus } from "./heading";
import { HomePage } from "./home";
import { NotFoundPage } from "./notfound";
import { PreviewPage } from "./preview";
import { EASE, PublicShell, reducedMotion } from "./shell";
import { StartPage } from "./start";
import { WorkPage } from "./work";
import "./public.css";

// The public site. A change of page wipes a full-height panel across the screen, left to right forward
// and right to left on Back or Forward, with `data-transition` on the root while it runs; the new page's
// level-1 heading then takes focus (PageHeading).

function wipe(direction: "forward" | "back"): void {
  const panel = document.querySelector<HTMLElement>(".wipe");
  if (!panel || reducedMotion()) return;
  const root = document.documentElement;
  root.setAttribute("data-transition", direction);
  const [from, to] = direction === "forward" ? ["-100%", "100%"] : ["100%", "-100%"];
  const animation = panel.animate(
    [{ transform: `translateX(${from})`, visibility: "visible" }, { transform: "translateX(0)", visibility: "visible" },
      { transform: `translateX(${to})`, visibility: "visible" }],
    { duration: 640, easing: EASE },
  );
  const done = (): void => {
    if (root.getAttribute("data-transition") === direction) root.removeAttribute("data-transition");
  };
  animation.finished.then(done, done);
}

function page(pathname: string, notFound: boolean) {
  if (notFound) return <NotFoundPage />;
  if (pathname === "/") return <HomePage />;
  if (pathname === "/work") return <WorkPage />;
  if (pathname === "/start") return <StartPage />;
  let params: Record<string, string> | null;
  if ((params = match("/work/:slug", pathname))) return <CaseStudyPage key={params.slug} slug={params.slug} />;
  if ((params = match("/preview/:token", pathname))) return <PreviewPage token={params.token} />;
  return <NotFoundPage />;
}

export function PublicApp({ notFound }: { notFound: boolean }) {
  const location = useLocation();
  const shown = useRef(location.pathname);
  if (shown.current !== location.pathname) {
    shown.current = location.pathname;
    markHeadingFocus();
  }
  const lastWiped = useRef(location.pathname);

  useLayoutEffect(() => {
    if (lastWiped.current === location.pathname) return;
    lastWiped.current = location.pathname;
    if (location.direction === "forward") window.scrollTo({ top: 0, behavior: "instant" });
    wipe(location.direction);
  }, [location.pathname, location.direction]);

  return <PublicShell>{page(location.pathname, notFound)}</PublicShell>;
}
