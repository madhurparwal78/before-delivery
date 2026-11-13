import { signin, signout, signup } from "./auth";
import { publicRoute, route, ok } from "./http";
import { addBarlow, addEyepiece, addSite, addTelescope, getKit, listSites } from "./kit";
import {
  checkPacket,
  createPacket,
  downloadPdf,
  getPacket,
  listPackets,
  packetStrokes,
  replaceRows,
  sendPacket,
  startRender,
} from "./packets";
import { getObservation, getProgram, getRaster, getSession, getStrokes, listObjects, listPrograms, listSessions, objectHistory, setFollow } from "./reads";
import { sync } from "./sync";

export function registerRoutes(): void {
  publicRoute("POST", "/api/auth/signup", ({ body }) => signup(body));
  publicRoute("POST", "/api/auth/signin", ({ body }) => signin(body));
  route("POST", "/api/auth/signout", ({ req }) => signout(req));
  route("GET", "/api/auth/me", async ({ account }) => ok({ account }));

  route("GET", "/api/kit", ({ account }) => getKit(account.id));
  route("POST", "/api/kit/telescopes", ({ account, body }) => addTelescope(account.id, body));
  route("POST", "/api/kit/eyepieces", ({ account, body }) => addEyepiece(account.id, body));
  route("POST", "/api/kit/barlows", ({ account, body }) => addBarlow(account.id, body));
  route("GET", "/api/sites", ({ account }) => listSites(account.id));
  route("POST", "/api/sites", ({ account, body }) => addSite(account.id, body));

  route("GET", "/api/objects", () => listObjects());
  route("GET", "/api/objects/:id/history", ({ account, params }) => objectHistory(account.id, params[0] as string));
  route("GET", "/api/sessions", ({ account }) => listSessions(account.id));
  route("GET", "/api/sessions/:id", ({ account, params }) => getSession(account.id, params[0] as string));
  route("GET", "/api/observations/:id", ({ account, params }) => getObservation(account.id, params[0] as string));
  route("GET", "/api/observations/:id/strokes", ({ account, params }) => getStrokes(account.id, params[0] as string));
  route("GET", "/api/observations/:id/raster", ({ account, params }) => getRaster(account.id, params[0] as string));

  route("POST", "/api/sync", ({ account, body }) => sync(account.id, body));

  route("GET", "/api/programs", ({ account }) => listPrograms(account.id));
  route("GET", "/api/programs/:id", ({ account, params }) => getProgram(account.id, params[0] as string));
  route("POST", "/api/programs/:id/follow", ({ account, params }) => setFollow(account.id, params[0] as string, true));
  route("DELETE", "/api/programs/:id/follow", ({ account, params }) => setFollow(account.id, params[0] as string, false));

  route("POST", "/api/packets", ({ account, body }) => createPacket(account.id, body));
  route("GET", "/api/packets", ({ account }) => listPackets(account.id));
  route("GET", "/api/packets/:id", ({ account, params }) => getPacket(account.id, params[0] as string));
  route("PUT", "/api/packets/:id/rows", ({ account, params, body }) => replaceRows(account.id, params[0] as string, body));
  route("POST", "/api/packets/:id/check", ({ account, params, body }) => checkPacket(account.id, params[0] as string, body));
  route("POST", "/api/packets/:id/render", ({ account, params, body }) => startRender(account.id, params[0] as string, body));
  route("POST", "/api/packets/:id/send", ({ account, params, body }) => sendPacket(account.id, params[0] as string, body));
  route("GET", "/api/packets/:id/pdf", ({ account, params }) => downloadPdf(account.id, params[0] as string));
  route("GET", "/api/packets/:id/strokes/:observation", ({ account, params }) => packetStrokes(account.id, params[0] as string, params[1] as string));
}
