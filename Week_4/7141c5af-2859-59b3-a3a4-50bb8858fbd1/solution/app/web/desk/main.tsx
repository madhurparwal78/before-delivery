import { render } from "preact";
import type { JSX } from "preact";
import { startRefresh } from "./lib/live.ts";
import { initRouter, useLocation } from "./lib/router.tsx";
import { Shell } from "./lib/shell.tsx";
import { matchRoute } from "./routes.tsx";

function App(): JSX.Element {
  const location = useLocation();
  const matched = matchRoute(location.path);
  if (!matched) {
    window.location.reload();
    return <Shell>{null}</Shell>;
  }
  const { Screen, id } = matched;
  return (
    <Shell>
      <Screen key={location.path} id={id} query={new URLSearchParams(location.search)} />
    </Shell>
  );
}

initRouter((path) => matchRoute(path) !== null);
startRefresh();
render(<App />, document.getElementById("app") as HTMLElement);
