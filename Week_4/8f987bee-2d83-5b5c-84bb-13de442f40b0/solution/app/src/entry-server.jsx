import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import App from "./App.jsx";

export function render(url) {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}
