import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { App } from "./App";

/** The markup the server puts in the page shell, so each route's copy needs no scripts. */
export function render(url: string): string {
  return renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
  );
}
