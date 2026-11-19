import type { IncomingMessage } from "node:http";
import { isLanguage, ANSWER_COPY, NOT_FOUND_HEADING, PASSPORT_COPY, TITLE_TAIL } from "../shared/copy";
import type { Language } from "../shared/catalog";
import type { Boot } from "../shared/api";
import { pool } from "./db";
import { fitsInteger } from "./figures";
import { lookUpSession, pathParam, type Answer, type Session } from "./http";
import { answerPageFor, loadLabel, loadStyle, passportFor, publicPassport } from "./domain";
import { answerPageJson } from "./routes/requests";
import { signOffJson, signOffPageFor } from "./routes/dossiers";
import { visitForDocument } from "./routes/visits";

const PUBLIC_HEADINGS: Record<string, string> = {
  "/": "Count every thread of a garment's footprint.",
  "/method": "How a footprint is worked out",
  "/questions": "Questions",
  "/sign-in": "Sign in",
  "/sign-up": "Start a desk",
};

const DESK_HEADINGS: Record<string, string> = {
  "/styles": "Styles",
  "/labels": "Labels",
  "/requests": "Requests",
  "/visits": "Visits",
  "/passports": "Passports",
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const INTRO_SCRIPT = `(function () {
  var key = "fio.intro.seen";
  function seen() { try { return localStorage.getItem(key) === "1"; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(key, "1"); } catch (e) {} }
  window.fioPlayIntro = function () {
    if (location.pathname !== "/" || seen()) return false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    remember();
    var root = document.getElementById("root");
    var intro = document.createElement("div");
    intro.setAttribute("data-part", "intro");
    intro.className = "intro";
    intro.innerHTML = '<p class="intro-name">Fio Contado Desk</p><p class="intro-words"><span>Materials</span><span>Making</span><span>Transport</span></p><button type="button" class="button intro-skip">Skip intro</button>';
    var skip = intro.querySelector("button");
    var done = false;
    function end() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey, true);
      intro.remove();
      root.inert = false;
      window.fioIntroPlaying = false;
      var heading = document.querySelector("h1");
      if (heading) heading.focus();
      document.dispatchEvent(new Event("fio-intro-end"));
    }
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); end(); }
      else if (event.key === "Tab") { event.preventDefault(); skip.focus(); }
    }
    skip.addEventListener("click", end);
    document.addEventListener("keydown", onKey, true);
    root.inert = true;
    window.fioIntroPlaying = true;
    document.body.appendChild(intro);
    skip.focus();
    var timer = setTimeout(end, 1600);
    return true;
  };
  window.fioPlayIntro();
})();`;

function shell(status: number, language: Language, heading: string, title: string, boot: Boot): Answer {
  const dir = language === "ar" ? "rtl" : "ltr";
  const bootJson = JSON.stringify(boot).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="${language}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}${TITLE_TAIL}</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="announcements" class="sr-only" role="status" aria-label="Announcements" aria-live="polite"></div>
<div id="root"><main><h1 tabindex="-1">${escapeHtml(heading)}</h1></main></div>
<div id="overlays"></div>
<script id="boot" type="application/json">${bootJson}</script>
<script>${INTRO_SCRIPT}</script>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`;
  return { status, text: html, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } };
}

function page(status: number, language: Language, heading: string, extra: Partial<Boot> = {}): Answer {
  return shell(status, language, heading, heading, { status, heading, ...extra });
}

function notFoundPage(): Answer {
  return page(404, "en", NOT_FOUND_HEADING);
}

async function deskHeading(path: string, session: Session): Promise<string | null> {
  const fixed = DESK_HEADINGS[path];
  if (fixed) return fixed;
  let match = /^\/styles\/([^/]+)(\/materials|\/scenarios)?$/.exec(path);
  if (match) {
    const style = await loadStyle(pool, session.assessorId, pathParam(match[1] as string)).catch(() => null);
    if (!style) return null;
    if (match[2] === "/materials") return `Materials for ${style.name}`;
    if (match[2] === "/scenarios") return `Scenarios for ${style.name}`;
    return style.name;
  }
  match = /^\/labels\/([^/]+)$/.exec(path);
  if (match) {
    const label = await loadLabel(pool, session.assessorId, pathParam(match[1] as string)).catch(() => null);
    return label ? (label.name as string) : null;
  }
  match = /^\/visits\/([^/]+)$/.exec(path);
  if (match) {
    const { rows } = await pool.query(`SELECT factory_name FROM visits WHERE id = $1 AND assessor_id = $2`, [pathParam(match[1] as string), session.assessorId]);
    return rows[0] ? `Visit to ${rows[0].factory_name}` : null;
  }
  return null;
}

const DESK_ADDRESS = /^\/(styles|labels|requests|visits|passports)(\/.*)?$/;

/** The document request itself answers the status, lang and dir before any script runs. */
export async function documentFor(request: IncomingMessage, url: URL): Promise<Answer> {
  const path = url.pathname;
  const publicHeading = PUBLIC_HEADINGS[path];
  if (publicHeading) return page(200, "en", publicHeading);

  const answer = /^\/a\/([^/]+)$/.exec(path);
  if (answer) {
    const token = pathParam(answer[1] as string);
    const found = await answerPageFor(pool, token);
    if (found.kind === "none") return notFoundPage();
    if (found.kind === "ended") {
      const copy = ANSWER_COPY[found.language];
      return page(410, found.language, copy.ended, { answerEnded: found.language });
    }
    const body = answerPageJson(found.row);
    return page(200, body.language, ANSWER_COPY[body.language].heading, { answer: { token, page: body } });
  }

  const signOff = /^\/s\/([^/]+)$/.exec(path);
  if (signOff) {
    const token = pathParam(signOff[1] as string);
    const found = await signOffPageFor(pool, token);
    if (found.kind === "none") return notFoundPage();
    if (found.kind === "ended") return page(410, "en", ANSWER_COPY.en.ended, { signOffEnded: true });
    const body = signOffJson(found.row);
    return page(200, "en", `Sign off ${body.dossier.styleName}`, { signOff: { token, page: body } });
  }

  const passport = /^\/p\/([^/]+)(?:\/e\/(\d+))?$/.exec(path);
  if (passport) {
    const lang = url.searchParams.get("lang");
    const language: Language = isLanguage(lang) ? lang : "en";
    const edition = passport[2] ? Number(passport[2]) : null;
    if (edition !== null && !fitsInteger(edition)) return notFoundPage();
    const found = await passportFor(pool, pathParam(passport[1] as string), edition);
    if (found.kind === "none") return notFoundPage();
    if (found.kind === "withdrawn") {
      return page(410, language, PASSPORT_COPY[language].withdrawn, { passportEnded: language, passportPath: path });
    }
    const body = publicPassport(found.row, language);
    return page(200, language, body.styleName, { passport: body, passportPath: path });
  }

  if (DESK_ADDRESS.test(path)) {
    const lookup = await lookUpSession(request);
    if (lookup.kind !== "live") {
      return { status: 303, headers: { Location: `/sign-in?next=${encodeURIComponent(path + url.search)}` } };
    }
    const heading = await deskHeading(path, lookup.session);
    if (!heading) return notFoundPage();
    const visitAddress = /^\/visits\/([^/]+)$/.exec(path);
    const visit = visitAddress ? await visitForDocument(lookup.session.assessorId, pathParam(visitAddress[1] as string)) : null;
    return page(200, "en", heading, visit ? { visit } : {});
  }

  return notFoundPage();
}
