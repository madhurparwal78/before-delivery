import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppFrame } from "./components/AppFrame";
import { LiveProvider } from "./lib/live";
import { RouterProvider, useRouter } from "./lib/router";
import { SessionProvider } from "./lib/session";
import { Audit } from "./pages/Audit";
import { DocumentPage } from "./pages/DocumentPage";
import { Documents } from "./pages/Documents";
import { NotFound } from "./pages/NotFound";
import { Sign } from "./pages/Sign";
import { SignIn } from "./pages/SignIn";
import { Team } from "./pages/Team";
import { Templates } from "./pages/Templates";

function routeFor(path: string): { element: ReactElement } | null {
  const document = /^\/documents\/([^/]+)$/.exec(path);
  const audit = /^\/documents\/([^/]+)\/audit$/.exec(path);
  if (path === "/documents") return { element: <Documents /> };
  if (document?.[1]) return { element: <DocumentPage id={document[1]} /> };
  if (audit?.[1]) return { element: <Audit id={audit[1]} /> };
  if (path === "/templates") return { element: <Templates /> };
  if (path === "/team") return { element: <Team /> };
  return null;
}

function App() {
  const { path } = useRouter();
  if (path === "/sign-in") return <SignIn />;
  const sign = /^\/sign\/([^/]+)$/.exec(path);
  if (sign?.[1]) return <Sign key={sign[1]} token={sign[1]} />;
  const route = routeFor(path);
  if (!route) {
    return (
      <main className="page">
        <NotFound />
      </main>
    );
  }
  const goToSignIn = () => window.location.assign(`/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return (
    <LiveProvider>
      <SessionProvider onSignedOut={goToSignIn}>
        <AppFrame>{route.element}</AppFrame>
      </SessionProvider>
    </LiveProvider>
  );
}

// Every face is fetched before the first paint, so no text is laid out in a fallback font and then reflowed when
// the real one swaps in (a hash or a heading that wraps differently would shift everything below it).
const FACES = ['600 16px "Fraunces"', '400 16px "Public Sans"', '600 16px "Public Sans"', '400 14px "IBM Plex Mono"', '500 14px "IBM Plex Mono"'];
const FONT_WAIT_MS = 3000;

function fontsReady(): Promise<unknown> {
  if (!("fonts" in document)) return Promise.resolve();
  const loads = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => undefined)));
  return Promise.race([loads, new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS))]);
}

const root = document.getElementById("root");
if (root) {
  void fontsReady().then(() =>
    createRoot(root).render(
      <RouterProvider>
        <App />
      </RouterProvider>,
    ),
  );
}


