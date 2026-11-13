import { json, type Ctx } from "./accounts.js";
import { bad, validation } from "../errors.js";
import { config } from "../config.js";
import { createGradingWorkspace, seedSampleFiles } from "../seeds.js";
import { setGradingClock, clearGradingClock, invalidateClocks } from "../clock.js";
import { isStudioZone } from "../config.js";
import { forgetTrialState } from "../presence.js";

export async function handleWorkspaceCreate(ctx: Ctx): Promise<void> {
  if (!config.grading) throw bad("not_found");
  const body = ctx.body as { preset?: string; time_zone?: string; units?: string };
  const preset = String(body?.preset ?? "");
  if (preset !== "blank" && preset !== "studio-plan") throw validation({ preset: "Choose a preset." });
  const zone = String(body?.time_zone ?? "UTC");
  if (!isStudioZone(zone)) throw validation({ time_zone: "Choose a studio time zone from the list." });
  const units = String(body?.units ?? "mm");
  if (units !== "mm" && units !== "m") throw validation({ units: "Choose units." });
  const seeded = await createGradingWorkspace(preset, zone, units);
  const { createSessionToken } = await import("../sessions.js");
  const token = await createSessionToken(seeded.workspaceId);
  json(ctx.res, 201, {
    workspace_id: seeded.workspaceId,
    drafter: { name: "Ines Halloran", email: seeded.drafterEmail, password: seeded.drafterPassword },
    reviewer: { name: "Tomas Wren", email: seeded.reviewerEmail },
    session: { name: "corbel_session", value: token },
    drawing: {
      id: seeded.drawingId,
      name: seeded.drawingName,
      url: `${config.publicUrl}/d/${seeded.drawingId}`,
      version: seeded.version,
    },
  });
}

export async function handleClockSet(ctx: Ctx, workspaceId: string): Promise<void> {
  if (!config.grading) throw bad("not_found");
  const body = ctx.body as { now?: string };
  if (typeof body?.now !== "string") throw validation({ now: "Enter a time." });
  const time = Date.parse(body.now);
  if (Number.isNaN(time)) throw validation({ now: "Enter a time." });
  const workspace = await dbOneWorkspace(workspaceId);
  if (!workspace) throw bad("not_found");
  await setGradingClock(workspaceId, new Date(time));
  await invalidateClocks();
  // Time moved: the next re-evaluation push must be seen as a change.
  forgetTrialState(workspaceId);
  json(ctx.res, 200, { now: body.now });
}

export async function handleClockClear(ctx: Ctx, workspaceId: string): Promise<void> {
  if (!config.grading) throw bad("not_found");
  const workspace = await dbOneWorkspace(workspaceId);
  if (!workspace) throw bad("not_found");
  await clearGradingClock(workspaceId);
  await invalidateClocks();
  forgetTrialState(workspaceId);
  ctx.res.writeHead(204);
  ctx.res.end();
}

async function dbOneWorkspace(workspaceId: string): Promise<{ id: string } | null> {
  const { db } = await import("../db.js");
  return db.one<{ id: string }>(`select id from workspaces where id = $1`, [workspaceId]);
}

export async function handleSeedSamples(): Promise<void> {
  await seedSampleFiles();
}
