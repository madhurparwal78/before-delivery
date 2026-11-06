// The route table: each published address renders its screen, an unknown
// address shows `Page not found` with a 404 status, and a signed-in address
// with no live session goes to the sign-in route.

import type { Screen, ScreenContext } from "../lib/ui";
import { el } from "../lib/ui";

export type { ScreenContext };
import { buildHome } from "./home";
import { buildReel } from "./reel";
import { buildHowItWorks } from "./how-it-works";
import { buildSignIn, buildSignUp } from "./auth";
import { buildJobs } from "./jobs";
import { buildClients, buildClient } from "./clients";
import { buildCalls } from "./calls";
import { buildBoard, buildScript, buildReelScreen, buildLines, buildCues, buildCuts, buildCompare, buildNotes, buildDelivery, buildLetter } from "./job";
import { buildNotFound } from "./notfound";
import { buildReview } from "./review";
import { buildSignOff } from "./signoff";
import { buildFee } from "./fee";

export async function renderScreen(ctx: ScreenContext, path: string): Promise<Screen> {
  const url = new URL(path, location.origin);
  const query = url.searchParams;
  const segments = url.pathname.split("/").filter((s) => s.length > 0);

  let build: { title: string; heading: HTMLElement; doc: HTMLElement; refresh: (() => Promise<void>) | null };

  if (segments.length === 0) {
    build = await wrap(ctx, "Boards drawn to the frame", await buildHome(ctx));
  } else if (segments[0] === "reel" && segments.length === 1) {
    build = await wrap(ctx, "Work on the reel", await buildReel(ctx, query));
  } else if (segments[0] === "how-it-works" && segments.length === 1) {
    build = await wrap(ctx, "How the work runs", await buildHowItWorks(ctx, query));
  } else if (segments[0] === "sign-in" && segments.length === 1) {
    build = await wrap(ctx, "Sign in", await buildSignIn(ctx, query));
  } else if (segments[0] === "sign-up" && segments.length === 1) {
    build = await wrap(ctx, "Start a desk", await buildSignUp(ctx));
  } else if (segments[0] === "desk") {
    build = await deskRoute(ctx, segments, query);
  } else if (segments[0] === "r" && segments.length === 2) {
    build = await wrap(ctx, "Review", await buildReview(ctx, segments[1]!));
  } else if (segments[0] === "s" && segments.length === 2) {
    build = await wrap(ctx, "Sign-off", await buildSignOff(ctx, segments[1]!));
  } else if (segments[0] === "f" && segments.length === 2) {
    build = await wrap(ctx, "Fee letter", await buildFee(ctx, segments[1]!));
  } else {
    build = await wrap(ctx, "Page not found", await buildNotFound(ctx));
  }

  return {
    title: build.title,
    heading: build.heading,
    doc: build.doc,
    refresh: build.refresh,
  };
}

async function deskRoute(ctx: ScreenContext, segments: string[], query: URLSearchParams): Promise<{ title: string; heading: HTMLElement; doc: HTMLElement; refresh: (() => Promise<void>) | null }> {
  if (segments.length === 1 && segments[0] === "jobs") {
    return await wrap(ctx, "Jobs", await buildJobs(ctx, query));
  }
  if (segments.length === 1 && segments[0] === "clients") {
    return await wrap(ctx, "Clients", await buildClients(ctx));
  }
  if (segments[0] === "clients" && segments.length === 2) {
    return await wrap(ctx, "Client", await buildClient(ctx, segments[1]!));
  }
  if (segments.length === 1 && segments[0] === "calls") {
    return await wrap(ctx, "Calls", await buildCalls(ctx, query));
  }
  if (segments[0] === "jobs" && segments.length === 2) {
    return await wrap(ctx, "Job", await buildBoard(ctx, segments[1]!));
  }
  if (segments[0] === "jobs" && segments.length === 3) {
    const jobId = segments[1]!;
    if (segments[2] === "script") return await wrap(ctx, "Script", await buildScript(ctx, jobId));
    if (segments[2] === "reel") return await wrap(ctx, "Reel", await buildReelScreen(ctx, jobId));
    if (segments[2] === "lines") return await wrap(ctx, "Lines", await buildLines(ctx, jobId, query));
    if (segments[2] === "cues") return await wrap(ctx, "Cues", await buildCues(ctx, jobId));
    if (segments[2] === "cuts") return await wrap(ctx, "Cuts", await buildCuts(ctx, jobId));
    if (segments[2] === "notes") return await wrap(ctx, "Notes", await buildNotes(ctx, jobId, query));
    if (segments[2] === "delivery") return await wrap(ctx, "Delivery", await buildDelivery(ctx, jobId));
    if (segments[2] === "letter") return await wrap(ctx, "Fee letter", await buildLetter(ctx, jobId));
  }
  if (segments[0] === "jobs" && segments.length === 4 && segments[2] === "compare") {
    return await wrap(ctx, "Compare cuts", await buildCompare(ctx, segments[1]!, query));
  }
  return await wrap(ctx, "Page not found", await buildNotFound(ctx));
}

async function wrap(_ctx: ScreenContext, fallbackTitle: string, build: { heading: HTMLElement; body: HTMLElement; frame?: HTMLElement | null; refresh?: (() => Promise<void>) | null; title?: string }): Promise<{ title: string; heading: HTMLElement; doc: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const doc = el("div", {});
  const headingText = build.heading.textContent ?? fallbackTitle;
  const page = el("div", { class: "page" });
  page.append(build.heading, build.body);
  doc.append(page);
  return {
    title: `${headingText} — Clapstick`,
    heading: build.heading,
    doc,
    refresh: build.refresh ?? null,
  };
}
