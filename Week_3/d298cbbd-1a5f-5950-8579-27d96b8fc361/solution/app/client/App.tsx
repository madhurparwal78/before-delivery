import type { JSX } from "preact";
import { Shell } from "./components/Shell";
import { mailOutage } from "./pages/AuthPages";
import { ResetConfirmPage, ResetRequestPage, SignInPage, SignUpPage, VerifyPage } from "./pages/AuthPages";
import { BoardsPage } from "./pages/BoardsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { RacePage, RoomPage } from "./pages/RacePages";
import { RunPage } from "./pages/RunPage";
import { AccountPage, NotFoundPage, SettingsPage } from "./pages/SimplePages";
import { Hero, TestPage } from "./pages/TestPage";
import { useLocation } from "./router";
import { useStore } from "./store";
import { viewer } from "./viewer";

function route(path: string): JSX.Element {
  const part = path.split("/");
  switch (part[1] ?? "") {
    case "":
      return path === "/" ? <TestPage /> : <NotFoundPage />;
    case "history":
      return part.length === 2 ? <HistoryPage /> : <NotFoundPage />;
    case "boards":
      return part.length === 2 ? <BoardsPage /> : <NotFoundPage />;
    case "race":
      return part.length === 2 ? <RacePage /> : part.length === 3 ? <RoomPage key={part[2]} code={part[2]!} /> : <NotFoundPage />;
    case "settings":
      return <SettingsPage />;
    case "account":
      return <AccountPage />;
    case "signup":
      return <SignUpPage />;
    case "signin":
      return <SignInPage />;
    case "reset":
      return part.length === 2 ? <ResetRequestPage /> : part.length === 3 ? <ResetConfirmPage token={part[2]!} /> : <NotFoundPage />;
    case "verify":
      return part.length === 3 ? <VerifyPage token={part[2]!} /> : <NotFoundPage />;
    case "runs":
      return part.length === 3 ? <RunPage id={part[2]!} /> : <NotFoundPage />;
    default:
      return <NotFoundPage />;
  }
}

export function App(): JSX.Element {
  const { path } = useLocation();
  const { ready } = useStore(viewer.state);
  const outage = useStore(mailOutage);
  return (
    <Shell hero={path === "/" ? <Hero /> : undefined}>
      {outage && (
        <p class="mail-slip" role="status" aria-label="Mail status">
          Email is unavailable. Your verification email will be sent when it recovers.
        </p>
      )}
      {ready ? route(path) : <p class="loading" aria-busy="true">Opening the drawer.</p>}
    </Shell>
  );
}
