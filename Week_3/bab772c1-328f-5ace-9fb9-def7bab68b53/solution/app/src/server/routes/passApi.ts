/** Everything under `/api/passes`. */

import { pool } from "../db/pool.js";
import { conflict, gone, notFound } from "../errors.js";
import { sendJson, type Context } from "../http/context.js";
import { findMissionRow, findPassRow, toPass } from "../domain/missionRead.js";
import { deletePass } from "../domain/passes.js";
import { methods, sendCapture } from "./common.js";

export async function passApi(
  context: Context,
  passId: string,
  rest: string[],
): Promise<void> {
  const pass = await findPassRow(pool, passId);
  if (!pass) {
    throw notFound();
  }
  if (pass.state === "deleted") {
    throw gone("pass_deleted");
  }
  const mission = await findMissionRow(pool, pass.mission_id);
  if (!mission) {
    throw notFound();
  }
  if (rest.length === 0) {
    await methods(context, {
      GET: async (ctx) => sendJson(ctx, 200, toPass(pass)),
      DELETE: async (ctx) => {
        if (pass.state === "uploading" || pass.state === "stored") {
          throw conflict("pass_not_settled", { state: pass.state });
        }
        await deletePass(mission, pass);
        ctx.response.writeHead(204).end();
      },
    });
    return;
  }
  if (rest.length === 1 && rest[0] === "capture") {
    await methods(context, { GET: async (ctx) => sendCapture(ctx, mission, pass) });
    return;
  }
  throw notFound();
}
