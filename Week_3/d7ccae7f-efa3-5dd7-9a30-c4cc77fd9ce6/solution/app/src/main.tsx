import { StrictMode, useEffect, useState, type ComponentType, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { Join } from "./Join";
import { AccountForm } from "./host/Accounts";
import { DeckEditor } from "./host/DeckEditor";
import { Decks } from "./host/Decks";
import { RequireQuizmaster } from "./host/HostShell";
import { NightResults, Nights } from "./host/Nights";
import { SessionProvider } from "./lib/session";
import { Play } from "./play/Play";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/host.css";
import "./styles/stage.css";
import "./styles/play.css";

// The stage (and Three.js) is fetched only when a quizmaster opens it. No Suspense: it must render without timers.
function LazyStage() {
  const [Stage, setStage] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("./stage/Stage").then((module) => setStage(() => module.Stage));
  }, []);
  return Stage ? <Stage /> : <div className="stage" aria-busy="true" />;
}

const guarded = (page: ReactElement): ReactElement => <RequireQuizmaster>{page}</RequireQuizmaster>;

// Only the quizmaster's screens ask who is signed in; the join page and the controller never call the account API.
const QuizmasterSession = () => (
  <SessionProvider>
    <Outlet />
  </SessionProvider>
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/play/:roomId" element={<Play />} />
        <Route element={<QuizmasterSession />}>
          <Route path="/host/login" element={<AccountForm mode="login" />} />
          <Route path="/host/signup" element={<AccountForm mode="signup" />} />
          <Route path="/host" element={guarded(<Decks />)} />
          <Route path="/host/decks/:deckId" element={guarded(<DeckEditor />)} />
          <Route path="/host/nights" element={guarded(<Nights />)} />
          <Route path="/host/nights/:roomId" element={guarded(<NightResults />)} />
          <Route path="/stage/:roomId" element={guarded(<LazyStage />)} />
        </Route>
        <Route path="*" element={<Join />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
