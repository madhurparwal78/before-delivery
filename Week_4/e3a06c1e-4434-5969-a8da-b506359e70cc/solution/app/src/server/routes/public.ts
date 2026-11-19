// Public routes: health, trial requests, the demo spectrum and the bundled tone fixture.
import { invalid, jsonFields, sendJson, type Router } from "../http";
import { email as emailOf, limited } from "../../shared/text";
import { one } from "../db";
import { refuseForeignOrigin } from "../access";
import { TONE_FIXTURE } from "../audio";
import { demoSpectrumRows } from "../seed";

export function registerPublic(router: Router): void {
  router.add("GET", "/api/health", async ({ res }) => sendJson(res, 200, { status: "ok" }));

  router.add("GET", "/api/public/demo-spectrum", async ({ res }) => sendJson(res, 200, { frame_rate: 30, rows: demoSpectrumRows() }));

  router.add("GET", "/fixtures/tone-1khz.wav", async ({ res }) => {
    res.writeHead(200, { "content-type": "audio/wav", "content-length": TONE_FIXTURE.length, "cache-control": "public, max-age=86400" });
    res.end(TONE_FIXTURE);
  });

  router.add("POST", "/api/trial-requests", async (request) => {
    refuseForeignOrigin(request.req);
    const body = jsonFields(request);
    const name = limited(body.name, 1, 100);
    const email = emailOf(body.email);
    const company = limited(body.company, 1, 100);
    const fields: Record<string, string> = {};
    if (name === null) fields.name = "Enter your name.";
    if (email === null) fields.email = "Enter a work email address.";
    if (company === null) fields.company = "Enter your company.";
    if (body.team !== "contact_centre" && body.team !== "clinical_dictation") fields.team = "Choose a team.";
    if (Object.keys(fields).length) throw invalid(fields);
    // A repeat from the same email is a replay of the first request.
    const created = await one<{ id: string; received_at: Date }>(
      "INSERT INTO trial_requests (name, email, company, team) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id, received_at",
      [name, email, company, body.team],
    );
    const row = created ?? (await one<{ id: string; received_at: Date }>("SELECT id, received_at FROM trial_requests WHERE lower(email) = lower($1)", [email]))!;
    sendJson(request.res, created ? 201 : 200, { id: row.id, received_at: row.received_at.toISOString() });
  });
}
