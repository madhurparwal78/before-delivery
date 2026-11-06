import "./styles.css";
import { options, render } from "preact";
import { onSessionLoss } from "./lib/api";
import { saveDrafts, useLocation } from "./lib/nav";
import { NotFoundPage, PublicShell, StaffShell } from "./ui/Shell";
import { PublicFleet, PublicYacht, SignIn } from "./screens/Public";
import { BrokerPage, ManifestPage } from "./screens/Guest";
import { Brokers, Charter, Charters, Hold, Holds, StaffYacht } from "./screens/Sales";
import { Profile, StaffFleet, Tariffs, Today } from "./screens/Fleet";
import { NewPassage, Passages, Planner } from "./screens/Passage";
import { Rota } from "./screens/Rota";
import { BerthBooking, Berths, ShorePower } from "./screens/Port";
import { StoreItem, Stores } from "./screens/Stores";
import { Energy } from "./screens/Energy";
import type { Member } from "./ui/Shell";
import type { ComponentChildren } from "preact";

// Effects run right after the browser has the new DOM, never on a frame timer.
options.requestAnimationFrame = (callback: () => void) => queueMicrotask(callback);

onSessionLoss((kind) => {
  if (kind === "session_ended") saveDrafts();
});

type Staff = (member: Member, params: string[], search: URLSearchParams) => ComponentChildren;

const STAFF: [RegExp, Staff][] = [
  [/^\/w\/([^/]+)\/today$/, (m) => <Today member={m} />],
  [/^\/w\/([^/]+)\/fleet$/, (m) => <StaffFleet member={m} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)$/, (m, p) => <StaffYacht member={m} slug={p[1]} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)\/profile$/, (m, p) => <Profile member={m} slug={p[1]} />],
  [/^\/w\/([^/]+)\/holds$/, (m) => <Holds member={m} />],
  [/^\/w\/([^/]+)\/holds\/([^/]+)$/, (m, p) => <Hold member={m} id={p[1]} />],
  [/^\/w\/([^/]+)\/charters$/, (m) => <Charters member={m} />],
  [/^\/w\/([^/]+)\/charters\/([^/]+)$/, (m, p) => <Charter member={m} id={p[1]} />],
  [/^\/w\/([^/]+)\/passages$/, (m, _p, s) => <Passages member={m} yacht={s.get("yacht")} />],
  [/^\/w\/([^/]+)\/passages\/new$/, (m) => <NewPassage member={m} />],
  [/^\/w\/([^/]+)\/passages\/([^/]+)$/, (m, p) => <Planner member={m} id={p[1]} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)\/rota$/, (m, p, s) => <Rota member={m} slug={p[1]} week={s.get("week")} />],
  [/^\/w\/([^/]+)\/berths$/, (m) => <Berths member={m} />],
  [/^\/w\/([^/]+)\/berth-bookings\/([^/]+)$/, (m, p) => <BerthBooking member={m} id={p[1]} />],
  [/^\/w\/([^/]+)\/shore-power$/, (m) => <ShorePower member={m} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)\/stores$/, (m, p) => <Stores member={m} slug={p[1]} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)\/stores\/([^/]+)$/, (m, p) => <StoreItem member={m} slug={p[1]} id={p[2]} />],
  [/^\/w\/([^/]+)\/yachts\/([^/]+)\/energy$/, (m, p) => <Energy member={m} slug={p[1]} />],
  [/^\/w\/([^/]+)\/brokers$/, (m) => <Brokers member={m} />],
  [/^\/w\/([^/]+)\/tariffs$/, (m) => <Tariffs member={m} />],
];

function App() {
  const here = useLocation();
  const path = here.path;
  for (const [pattern, screen] of STAFF) {
    const match = pattern.exec(path);
    if (match) {
      const params = match.slice(1).map(decodeURIComponent);
      return (
        <StaffShell key={path} planner={/\/passages\/(?!new$)[^/]+$/.test(path)}>
          {(member) => (member.workspaceSlug === params[0] ? screen(member, params, here.search) : <NotFoundPage />)}
        </StaffShell>
      );
    }
  }
  let match = /^\/fleet\/([^/]+)$/.exec(path);
  if (match) return <PublicShell><PublicFleet workspace={decodeURIComponent(match[1])} /></PublicShell>;
  match = /^\/fleet\/([^/]+)\/([^/]+)$/.exec(path);
  if (match) return <PublicShell key={path}><PublicYacht workspace={decodeURIComponent(match[1])} slug={decodeURIComponent(match[2])} /></PublicShell>;
  match = /^\/m\/([^/]+)$/.exec(path);
  if (match) return <PublicShell><ManifestPage token={match[1]} /></PublicShell>;
  match = /^\/b\/([^/]+)$/.exec(path);
  if (match) return <PublicShell><BrokerPage token={match[1]} /></PublicShell>;
  if (path === "/sign-in") return <PublicShell><SignIn returnTo={here.search.get("return")} /></PublicShell>;
  return <PublicShell><NotFoundPage /></PublicShell>;
}

render(<App />, document.getElementById("app")!);
