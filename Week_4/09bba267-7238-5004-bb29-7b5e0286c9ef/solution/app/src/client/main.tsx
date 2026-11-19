// The browser entry: one frame, the page the address names, live updates and offer announcements.
import type { JSX } from "preact";
import { options, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { announce } from "./announce.js";
import { Frame } from "./components.js";
import { connectLive, useLive } from "./live.js";
import { MyTickets } from "./pages/MyTickets.js";
import { NotFound } from "./pages/NotFound.js";
import { OfferPage } from "./pages/OfferPage.js";
import { OwnerPage } from "./pages/Owner.js";
import { Programme } from "./pages/Programme.js";
import { usePath } from "./router.js";
import { SeatMapPage } from "./seatmap/SeatMapPage.js";
import "./styles.css";

// Effects run as soon as each render commits rather than on the next animation frame, so the pages load and stay
// live while no frame is painted (a background tab, or a page whose clock is held still).
options.requestAnimationFrame = (callback) => queueMicrotask(callback);

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Programme"], [/^\/tickets$/, "My tickets"], [/^\/p\//, "Seat map"], [/^\/offers\//, "A seat for you"], [/^\/owner/, "Owner"],
];

function page(path: string): JSX.Element {
  const show = /^\/p\/([a-z0-9-]+)$/.exec(path);
  const offer = /^\/offers\/([A-Za-z0-9_-]+)$/.exec(path);
  if (path === "/") return <Programme />;
  if (path === "/tickets") return <MyTickets />;
  if (show) return <SeatMapPage key={show[1]} performanceId={show[1]} />;
  if (offer) return <OfferPage key={offer[1]} token={offer[1]} />;
  if (path === "/owner") return <OwnerPage view="dashboard" />;
  if (path === "/owner/new") return <OwnerPage view="new" />;
  if (path === "/owner/orders") return <OwnerPage view="orders" />;
  if (path === "/owner/outbox") return <OwnerPage view="outbox" />;
  return <NotFound />;
}

function App(): JSX.Element {
  const path = usePath();
  const offered = useRef(new Set<string>());
  connectLive(/^\/offers\/([A-Za-z0-9_-]+)$/.exec(path)?.[1] ?? null);

  // An offer for this browser's waitlist entry is announced once on every open page.
  useLive((event) => {
    if (event.type !== "offer" || offered.current.has(event.token)) return;
    offered.current.add(event.token);
    announce(`A seat is offered to you: ${event.label}.`);
  });

  useEffect(() => {
    const title = TITLES.find(([pattern]) => pattern.test(path))?.[1] ?? "Not found";
    document.title = `${title} · Halyard Hall Box Office`;
  }, [path]);

  return <Frame path={path}>{page(path)}</Frame>;
}

// The first paint waits for the self-hosted faces, so text never reflows when a font arrives late.
const FACES = ['600 1em "Fraunces"', 'italic 400 1em "Fraunces"', '400 1em "Public Sans"', '600 1em "Public Sans"'];
void Promise.allSettled(FACES.map((face) => document.fonts.load(face)))
  .then(() => render(<App />, document.getElementById("app") as HTMLElement));
