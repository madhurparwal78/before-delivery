import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Role } from "../shared/rules";
import { Header } from "./components/Header";
import "./fonts.css";
import { Console } from "./pages/Console";
import { Editor } from "./pages/Editor";
import { Gallery } from "./pages/Gallery";
import { Landing } from "./pages/Landing";
import { Library } from "./pages/Library";
import { Gate, NotFound } from "./pages/NotFound";
import { PiecePage } from "./pages/PiecePage";
import { Studio, StudioCredits } from "./pages/Studio";
import { Router, useLocation } from "./router";
import { SessionProvider, useSession } from "./session";
import "./styles.css";

function Guarded({ role, name, children }: { role: Role; name: string; children: ReactNode }) {
  const { me, loaded } = useSession();
  if (!loaded) return <div className="page" aria-busy="true" />;
  if (!me || !me.roles.includes(role)) return <Gate role={name} />;
  return <>{children}</>;
}

function Screen() {
  const { path } = useLocation();
  const piece = /^\/pieces\/([a-z0-9-]+)$/.exec(path);
  const editor = /^\/studio\/pieces\/([a-z0-9-]+)$/.exec(path);
  if (path === "/") return <Landing />;
  if (path === "/gallery") return <Gallery />;
  if (piece?.[1]) return <PiecePage key={piece[1]} slug={piece[1]} />;
  if (path === "/studio") return <Guarded role="creator" name="creator"><Studio /></Guarded>;
  if (path === "/studio/credits") return <Guarded role="creator" name="creator"><StudioCredits /></Guarded>;
  if (editor?.[1]) return <Guarded role="creator" name="creator"><Editor key={editor[1]} slug={editor[1]} /></Guarded>;
  if (path === "/library") return <Guarded role="collector" name="collector"><Library /></Guarded>;
  if (path === "/console") return <Guarded role="founder-operator" name="founder-operator"><Console /></Guarded>;
  return <NotFound />;
}

function App() {
  return (
    <Router>
      <SessionProvider>
        <a className="skip-link" href="#main">Skip to content</a>
        <Header />
        <main id="main" tabIndex={-1}>
          <Screen />
        </main>
        <footer className="site-footer">
          <p>
            <span className="wordmark-mark" aria-hidden="true" /> Phosphene Yard is run by Brightmoss Works. Editions settle in USD; invoices carry VAT by billing country.
          </p>
        </footer>
      </SessionProvider>
    </Router>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
