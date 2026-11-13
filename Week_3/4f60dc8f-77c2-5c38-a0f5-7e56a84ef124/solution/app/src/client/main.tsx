// The client entry: one stage canvas behind the page, in-place navigation, and a route per published screen.
import { options, render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "./styles.css";
import { EngagementPage } from "./pages/Engagement";
import { Home } from "./pages/Home";
import { AccountPage, CaseStudyPage, NotFound, SignInPage, StartPage } from "./pages/Public";
import { ReviewPage } from "./pages/Review";
import { RigPage } from "./pages/Rig";
import { interceptLinks, usePlace } from "./router";

type StudioPages = Pick<typeof import("./pages/Studio"), "StudioPage" | "StudioEngagementPage">;

/** The founder's pages load on demand, so the public pages never download the studio's sign-in code. */
function Studio({ id }: { id: string | null }) {
  const [studio, setStudio] = useState<StudioPages | null>(null);
  useEffect(() => {
    void import("./pages/Studio").then(({ StudioPage, StudioEngagementPage }) => setStudio({ StudioPage, StudioEngagementPage }));
  }, []);
  if (!studio) return <div class="skeleton" aria-hidden="true" />;
  return id ? <studio.StudioEngagementPage id={id} /> : <studio.StudioPage />;
}

function App() {
  const { path, search, hash } = usePlace();
  const first = useRef(true);
  useEffect(() => {
    // After an in-place navigation, focus moves to the new page's main content; the first load keeps the skip link first.
    if (first.current) first.current = false;
    else document.getElementById("main")?.focus({ preventScroll: true });
  }, [path]);
  const match = (pattern: RegExp): string | null => pattern.exec(path)?.[1] ?? null;
  if (path === "/") return <Home hash={hash} />;
  if (path === "/start") return <StartPage />;
  if (path === "/sign-in") return <SignInPage search={search} />;
  if (path === "/account") return <AccountPage />;
  if (path === "/studio") return <Studio id={null} />;
  const work = match(/^\/work\/([^/]+)$/);
  if (work) return <CaseStudyPage key={work} slug={decodeURIComponent(work)} />;
  const engagement = match(/^\/account\/engagements\/([^/]+)$/);
  if (engagement) return <EngagementPage key={engagement} id={engagement} />;
  const rig = match(/^\/rig\/([^/]+)$/);
  if (rig) return <RigPage key={rig} id={rig} />;
  const review = match(/^\/review\/([^/]+)$/);
  if (review) return <ReviewPage key={review} token={review} />;
  const studio = match(/^\/studio\/engagements\/([^/]+)$/);
  if (studio) return <Studio key={studio} id={studio} />;
  return <NotFound />;
}

// Effects run on the next task rather than the next animation frame, so data loads and media queries settle even
// while a page's frames are paused (a background tab, or a test clock).
options.requestAnimationFrame = (callback) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => callback();
  channel.port2.postMessage(null);
};

interceptLinks();
const root = document.getElementById("app") as HTMLElement;
root.textContent = "";
root.className = "app-root";
render(<App />, root);
