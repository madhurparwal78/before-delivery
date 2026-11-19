import { useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { usePath } from "./ui.js";
import { Landing } from "./pages/Landing.js";

/** Every page but the landing page loads as its own chunk when its route opens. */
function Lazy({ load }: { load: () => Promise<ReactElement> }) {
  const [page, setPage] = useState<ReactElement | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((element) => live && setPage(element));
    return () => {
      live = false;
    };
  }, []);
  return page ?? <p className="page-loading muted">Loading…</p>;
}

function App() {
  const path = usePath();
  const [, first = "", second = ""] = path.split("/");
  const param = decodeURIComponent(second);
  switch (first) {
    case "signin":
      return <Lazy key={path} load={() => import("./pages/SignIn.js").then((m) => <m.SignIn />)} />;
    case "workshops":
      return <Lazy key={path} load={() => import("./pages/Workshops.js").then((m) => <m.Workshops />)} />;
    case "billing":
      return <Lazy key={path} load={() => import("./pages/Billing.js").then((m) => <m.Billing />)} />;
    case "activity":
      return <Lazy key={path} load={() => import("./pages/Activity.js").then((m) => <m.Activity />)} />;
    case "join":
      return <Lazy key={path} load={() => import("./pages/Join.js").then((m) => <m.Join token={param} />)} />;
    case "w":
      return <Lazy key={path} load={() => import("./room/Room.js").then((m) => <m.Room workshopId={param} />)} />;
    case "recap":
      return <Lazy key={path} load={() => import("./pages/Recap.js").then((m) => <m.Recap token={param} />)} />;
    default:
      return <Landing />;
  }
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
