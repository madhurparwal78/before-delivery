import { render, type JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { Boot } from "../shared/api";
import { DeskFrame } from "./frame";
import { focusHeading, place, seedResource, startNavigation, startRefresh } from "./lib";
import { Home, Method, NotFound, Questions, SignIn, SignUp } from "./screens/public";
import { LabelPage, Labels } from "./screens/labels";
import { Materials } from "./screens/materials";
import { PassportEnded, PassportPage, Passports } from "./screens/passports";
import { AnswerEnded, AnswerScreen, SignOffEnded, SignOffScreen } from "./screens/private";
import { Requests } from "./screens/requests";
import { Scenarios } from "./screens/scenarios";
import { StylePage } from "./screens/style";
import { Styles } from "./screens/styles";
import { VisitPage, Visits } from "./screens/visits";

const boot = JSON.parse((document.getElementById("boot") as HTMLElement).textContent as string) as Boot;
if (boot.visit) seedResource(`/api/visits/${boot.visit.id}`, boot.visit);

function screenFor(path: string): JSX.Element {
  if (boot.status === 404) return <NotFound />;
  if (boot.answer) return <AnswerScreen token={boot.answer.token} initial={boot.answer.page} language={boot.answer.page.language} />;
  if (boot.answerEnded) return <AnswerEnded language={boot.answerEnded} />;
  if (boot.signOff) return <SignOffScreen token={boot.signOff.token} initial={boot.signOff.page} />;
  if (boot.signOffEnded) return <SignOffEnded />;
  if (boot.passport) return <PassportPage passport={boot.passport} path={boot.passportPath as string} />;
  if (boot.passportEnded) return <PassportEnded language={boot.passportEnded} path={boot.passportPath as string} />;
  switch (path) {
    case "/":
      return <Home />;
    case "/method":
      return <Method />;
    case "/questions":
      return <Questions />;
    case "/sign-in":
      return <SignIn />;
    case "/sign-up":
      return <SignUp />;
    default:
      return <DeskRoutes path={path} />;
  }
}

function DeskRoutes({ path }: { path: string }): JSX.Element {
  let screen: JSX.Element | null = null;
  const [, first, second, third] = path.split("/");
  if (first === "styles" && !second) screen = <Styles />;
  else if (first === "styles" && second && !third) screen = <StylePage key={second} id={second} />;
  else if (first === "styles" && second && third === "materials") screen = <Materials key={second} id={second} />;
  else if (first === "styles" && second && third === "scenarios") screen = <Scenarios key={second} id={second} />;
  else if (first === "labels" && !second) screen = <Labels />;
  else if (first === "labels" && second) screen = <LabelPage key={second} id={second} />;
  else if (first === "requests") screen = <Requests />;
  else if (first === "visits" && !second) screen = <Visits />;
  else if (first === "visits" && second) screen = <VisitPage key={second} id={second} />;
  else if (first === "passports") screen = <Passports />;
  if (!screen) return <NotFound />;
  return <DeskFrame current={path}>{screen}</DeskFrame>;
}

function App(): JSX.Element {
  const here = place.use();
  const lastPath = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (here.pathname === lastPath.current) return;
    lastPath.current = here.pathname;
    const dialogOpen = document.querySelector("#overlays [role=dialog]");
    if (!window.fioIntroPlaying && !dialogOpen && !here.restore) focusHeading();
    if (!here.restore) scrollTo({ top: 0, behavior: "instant" });
    if (here.hash) {
      const target = document.getElementById(here.hash.slice(1));
      target?.scrollIntoView();
    }
  }, [here.pathname, here.hash]);

  return screenFor(here.pathname);
}

/** A control that takes focus is scrolled fully into view between the top bar and the bottom bar. */
function keepFocusInView(): void {
  document.addEventListener("focusin", (event) => {
    const element = event.target as HTMLElement;
    if (element.closest("#overlays")) return;
    const bar = document.querySelector<HTMLElement>(".action-bar,.answer-bar");
    if (!bar || getComputedStyle(bar).position !== "fixed" || bar.contains(element)) return;
    const box = element.getBoundingClientRect();
    const top = bar.getBoundingClientRect().top;
    if (box.bottom > top) scrollBy({ top: box.bottom - top + 8, behavior: "instant" });
  });
}

/** The first draw waits briefly for the text faces, so a late swap never re-wraps a drawn screen. */
function facesReady(): Promise<unknown> {
  const faces = document.documentElement.lang === "ar" ? ["300 1rem Sora", "400 1rem Sora", "400 1rem 'Noto Sans Arabic'"] : ["300 1rem Sora", "400 1rem Sora"];
  const loads = faces.map((face) => document.fonts.load(face, face.includes("Arabic") ? "\u0627" : "A"));
  return Promise.race([Promise.allSettled(loads), new Promise((resolve) => setTimeout(resolve, 500))]);
}

startNavigation();
startRefresh();
keepFocusInView();
document.addEventListener("fio-intro-end", focusHeading);
void facesReady().then(() => {
  const root = document.getElementById("root") as HTMLElement;
  root.replaceChildren();
  render(<App />, root);
});
