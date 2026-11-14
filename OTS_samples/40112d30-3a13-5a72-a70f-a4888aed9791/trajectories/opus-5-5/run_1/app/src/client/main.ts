import "./styles.css";
import { M } from "../shared/messages.js";
import { messagePage, notFoundPage } from "./layout.js";
import { builderPage } from "./screens/builder.js";
import { editionsPage, editionView, formsList, responsesPage, responseView, summaryPage } from "./screens/owner.js";
import { invitation, marketing, signin, signup } from "./screens/public.js";
import { fillForm, resumeForm } from "./screens/respondent.js";

type Route = [RegExp, (...params: string[]) => void | Promise<void>];

const ROUTES: Route[] = [
  [/^\/$/, marketing],
  [/^\/signup$/, signup],
  [/^\/signin$/, signin],
  [/^\/forms$/, formsList],
  [/^\/forms\/([^/]+)\/edit$/, builderPage],
  [/^\/forms\/([^/]+)\/summary$/, summaryPage],
  [/^\/forms\/([^/]+)\/responses$/, responsesPage],
  [/^\/forms\/([^/]+)\/responses\/([^/]+)$/, responseView],
  [/^\/forms\/([^/]+)\/editions$/, editionsPage],
  [/^\/forms\/([^/]+)\/editions\/(\d+)$/, (id, n) => editionView(id, Number(n))],
  [/^\/f\/([^/]+)$/, fillForm],
  [/^\/r\/([^/]+)$/, resumeForm],
  [/^\/invite\/([^/]+)$/, invitation],
];

function route(): void {
  const status = document.querySelector<HTMLMetaElement>('meta[name="nf-status"]')?.content;
  const reason = document.querySelector<HTMLMetaElement>('meta[name="nf-reason"]')?.content;
  if (reason === "LINK_EXPIRED" || reason === "ALREADY_SENT") {
    messagePage(reason === "LINK_EXPIRED" ? M.linkExpired : M.alreadySent);
    return;
  }
  if (status === "404") {
    notFoundPage();
    return;
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  for (const [pattern, screen] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      void screen(...match.slice(1).map(decodeURIComponent));
      return;
    }
  }
  notFoundPage();
}

route();
