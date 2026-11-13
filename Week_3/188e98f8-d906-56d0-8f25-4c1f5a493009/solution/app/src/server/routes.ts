import type { Handler } from "./context";
import { json } from "./context";
import { isReady } from "./db";
import { listArchive, listRoundAnswers, putMark, searchAnswers, submitAnswers } from "./answers";
import { listDisputes, raiseDispute, ruleOnDispute } from "./disputes";
import { closeRound, downloadSheet, finishMarking, listRounds, openRound, publishRound, showRound, uploadSheet } from "./rounds";
import { currentSession, signIn, signOut } from "./sessions";
import { renameTeam, showTable } from "./teams";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** How an endpoint's body is read: none, JSON (up to 16,384 bytes) or a raw sheet (up to 5,000,000 bytes). */
type BodyKind = "none" | "json" | "sheet";

interface Endpoint {
  run: Handler;
  /** Whether the endpoint needs a desk session. */
  session: boolean;
  body: BodyKind;
}

interface Route {
  pattern: RegExp;
  methods: Partial<Record<Method, Endpoint>>;
}

const open = (run: Handler, body: BodyKind = "none"): Endpoint => ({ run, session: false, body });
const desk = (run: Handler, body: BodyKind = "none"): Endpoint => ({ run, session: true, body });

export const health: Handler = async () => (isReady() ? json(200, { status: "ok" }) : json(503, { status: "starting" }));

export const ROUTES: Route[] = [
  { pattern: /^\/api\/health$/, methods: { GET: open(health) } },
  {
    pattern: /^\/api\/session$/,
    methods: { POST: open(signIn, "json"), GET: desk(currentSession), DELETE: desk(signOut) },
  },
  { pattern: /^\/api\/rounds$/, methods: { GET: open(listRounds) } },
  { pattern: /^\/api\/rounds\/([^/]+)$/, methods: { GET: open(showRound) } },
  { pattern: /^\/api\/table$/, methods: { GET: open(showTable) } },
  { pattern: /^\/api\/rounds\/([^/]+)\/sheet$/, methods: { PUT: desk(uploadSheet, "sheet"), GET: desk(downloadSheet) } },
  { pattern: /^\/api\/rounds\/([^/]+)\/open$/, methods: { POST: desk(openRound) } },
  { pattern: /^\/api\/rounds\/([^/]+)\/close$/, methods: { POST: desk(closeRound) } },
  { pattern: /^\/api\/rounds\/([^/]+)\/publish$/, methods: { POST: desk(publishRound) } },
  { pattern: /^\/api\/rounds\/([^/]+)\/marked$/, methods: { POST: desk(finishMarking) } },
  {
    pattern: /^\/api\/rounds\/([^/]+)\/answers$/,
    methods: { POST: desk(submitAnswers, "json"), GET: desk(listRoundAnswers) },
  },
  { pattern: /^\/api\/rounds\/([^/]+)\/marks$/, methods: { PUT: desk(putMark, "json") } },
  { pattern: /^\/api\/answers$/, methods: { GET: desk(listArchive) } },
  { pattern: /^\/api\/answers\/search$/, methods: { POST: desk(searchAnswers, "json") } },
  { pattern: /^\/api\/teams\/([^/]+)$/, methods: { PATCH: desk(renameTeam, "json") } },
  { pattern: /^\/api\/disputes$/, methods: { POST: desk(raiseDispute, "json"), GET: desk(listDisputes) } },
  { pattern: /^\/api\/disputes\/([^/]+)\/ruling$/, methods: { POST: desk(ruleOnDispute, "json") } },
];
