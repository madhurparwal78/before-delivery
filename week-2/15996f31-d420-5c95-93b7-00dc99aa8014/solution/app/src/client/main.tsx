import { createRoot } from "react-dom/client";
import { Desk } from "./desk/Desk.js";
import { DropDetail } from "./desk/DropDetail.js";
import { FeedbackProvider } from "./feedback.js";
import { useLocation } from "./hooks.js";
import { InspectionSheet } from "./inspect/InspectionSheet.js";
import { PatternDefs } from "./PlatMap.js";
import { SignIn } from "./SignIn.js";
import "./styles.css";

function Page() {
  const { path } = useLocation();
  const drop = /^\/desk\/drops\/([^/]+)$/.exec(path);
  const inspect = /^\/inspect\/([^/]+)$/.exec(path);
  if (drop) return <DropDetail dropId={decodeURIComponent(drop[1])} />;
  if (inspect) return <InspectionSheet token={decodeURIComponent(inspect[1])} />;
  if (path.startsWith("/desk")) return <Desk />;
  return <SignIn />;
}

function App() {
  return (
    <FeedbackProvider>
      <PatternDefs />
      <div className="shell">
        <Page />
      </div>
    </FeedbackProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
