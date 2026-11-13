import type { VNode } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { ownerText } from "../shared/copy";
import { Check, Layers, TriangleAlert } from "./icons";
import { LanguageSwitch } from "./LanguageSwitch";
import { setOperatorLanguage, useLanguage } from "./language";
import { resetMessages, statusText, useMessages } from "./messages";
import { onLinkClick, usePath } from "./router";
import { ClaimNew } from "./pages/ClaimNew";
import { Confirm } from "./pages/Confirm";
import { Find } from "./pages/Find";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Sent } from "./pages/Sent";
import { Share } from "./pages/Share";
import { Editions } from "./pages/ops/Editions";
import { Imports } from "./pages/ops/Imports";
import { Queue } from "./pages/ops/Queue";
import { SignIn } from "./pages/ops/SignIn";
import { Workspace } from "./pages/ops/Workspace";

interface Route {
  key: string;
  ops: boolean;
  page: VNode;
}

function resolve(path: string): Route {
  const at = (pattern: RegExp): string[] | null => pattern.exec(path);
  let found: string[] | null;
  if (path === "/") return { key: "home", ops: false, page: <Home /> };
  if (path === "/claim/new") return { key: "claim-new", ops: false, page: <ClaimNew /> };
  if ((found = at(/^\/claim\/([^/]+)\/sent$/))) return { key: `sent:${found[1]}`, ops: false, page: <Sent reference={found[1] ?? ""} /> };
  if ((found = at(/^\/confirm\/([^/]+)$/))) return { key: `confirm:${found[1]}`, ops: false, page: <Confirm token={found[1] ?? ""} /> };
  if ((found = at(/^\/s\/([^/]+)$/))) return { key: `share:${found[1]}`, ops: false, page: <Share token={found[1] ?? ""} /> };
  if (path === "/find") return { key: "find", ops: false, page: <Find /> };
  if (path === "/ops/sign-in") return { key: "sign-in", ops: true, page: <SignIn /> };
  if (path === "/ops/claims") return { key: "queue", ops: true, page: <Queue /> };
  if ((found = at(/^\/ops\/claims\/([^/]+)(?:\/(?:quote(?:\/[^/]+)?|declined|dispatched))?$/))) {
    return { key: `workspace:${found[1]}`, ops: true, page: <Workspace reference={found[1] ?? ""} /> };
  }
  if (path === "/ops/imports") return { key: "imports", ops: true, page: <Imports /> };
  if (path === "/ops/editions") return { key: "editions", ops: true, page: <Editions /> };
  return { key: "not-found", ops: path.startsWith("/ops"), page: <NotFound /> };
}

function MessageBand() {
  const messages = useMessages();
  const text = statusText(messages);
  return (
    <div class="band" data-pending={messages.pending ? "true" : "false"}>
      <div class="status-line" role="status" aria-live="polite">
        {text ? <Check /> : null}
        {text}
      </div>
      <div class="alert-line" id="alert-region" role="alert" tabIndex={-1}>
        {messages.alert ? <TriangleAlert /> : null}
        {messages.alert}
      </div>
    </div>
  );
}

export function App() {
  const path = usePath();
  const lang = useLanguage();
  const route = resolve(path);
  const operator = route.ops;

  useLayoutEffect(() => {
    resetMessages();
  }, [route.key]);

  useLayoutEffect(() => {
    if (operator) setOperatorLanguage();
    else document.documentElement.lang = lang;
  }, [operator, lang]);

  const skip = operator ? "Skip to claim workspace" : ownerText("skipToClaim", lang);
  return (
    <>
      <a
        class="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {skip}
      </a>
      <header class="site-header">
        <a class="brand" href={operator ? "/ops/claims" : "/"} onClick={(event) => onLinkClick(event, operator ? "/ops/claims" : "/")}>
          <Layers size={22} />
          Holmgarth Aftercare
        </a>
        {operator ? (
          route.key === "sign-in" ? null : (
            <nav class="ops-nav" aria-label="Operator">
              <a href="/ops/claims" onClick={(event) => onLinkClick(event, "/ops/claims")}>Claims</a>
              <a href="/ops/imports" onClick={(event) => onLinkClick(event, "/ops/imports")}>Imports</a>
              <a href="/ops/editions" onClick={(event) => onLinkClick(event, "/ops/editions")}>Editions</a>
            </nav>
          )
        ) : (
          <LanguageSwitch />
        )}
      </header>
      <MessageBand />
      <main id="main" tabIndex={-1} key={route.key}>
        {route.page}
      </main>
    </>
  );
}
