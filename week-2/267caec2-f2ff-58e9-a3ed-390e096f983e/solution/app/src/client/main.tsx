import { options, render } from "preact";
import { DeskProvider, useDesk } from "./desk";
import { SignIn, SignUp } from "./pages/auth";
import { DirectorAudit, DirectorCategory, DirectorHome, DirectorProgram, DirectorRound } from "./pages/director";
import { JuryBallot, JuryConflicts, JuryHome } from "./pages/jury";
import { Gallery, Leaderboard } from "./pages/public";
import { StudioEntries, StudioEntry } from "./pages/studio";

// Every screen in the brief's screen list, and nothing else.

function Screen() {
  const { path } = useDesk();
  const route = path.split("?")[0] ?? "/";
  const id = (prefix: string) => (route.startsWith(prefix) ? decodeURIComponent(route.slice(prefix.length)) : null);
  if (route === "/") return <Leaderboard />;
  if (route === "/gallery") return <Gallery />;
  if (route === "/signin") return <SignIn />;
  if (route === "/signup") return <SignUp />;
  if (route === "/studio") return <StudioEntries />;
  if (route === "/studio/entries/new") return <StudioEntry id={null} />;
  const entry = id("/studio/entries/");
  if (entry) return <StudioEntry id={entry} />;
  if (route === "/jury") return <JuryHome />;
  if (route === "/jury/conflicts") return <JuryConflicts />;
  const ballot = id("/jury/rounds/");
  if (ballot) return <JuryBallot id={ballot} />;
  if (route === "/director") return <DirectorHome />;
  if (route === "/director/audit") return <DirectorAudit />;
  const program = id("/director/programs/");
  if (program) return <DirectorProgram id={program} />;
  const category = id("/director/categories/");
  if (category) return <DirectorCategory id={category} />;
  const round = id("/director/rounds/");
  if (round) return <DirectorRound id={round} />;
  return <p class="notice">We couldn't find that.</p>;
}

// Effects run right after each commit instead of on the next animation frame, so data loads and live refresh keep
// working in background tabs, where frames are paused.
options.requestAnimationFrame = (callback) => void Promise.resolve().then(callback);

const root = document.getElementById("app") as HTMLElement;
root.textContent = "";
render(<DeskProvider><Screen /></DeskProvider>, root);
