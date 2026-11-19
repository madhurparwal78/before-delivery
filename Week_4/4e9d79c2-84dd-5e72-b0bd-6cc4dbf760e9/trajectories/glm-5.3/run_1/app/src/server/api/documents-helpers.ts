import type { Ctx } from "../app.js";
import { ukTimeHM } from "../domain.js";

export async function fileRateLimited(
  ctx: Ctx,
  deskId: string,
  now: Date,
  action: string
): Promise<{ seconds: number; message: string } | null> {
  const windowSeconds = ctx.cfg.fileRateWindowSeconds;
  const rows = await ctx.db.query(
    "SELECT at FROM file_rate WHERE desk_id=$1 AND action=$2 AND at > NOW() - ($3 || ' seconds')::interval ORDER BY at",
    [deskId, action, String(windowSeconds)]
  );
  if (rows.rows.length >= 5) {
    const retryAt = new Date((rows.rows[0].at as Date).getTime() + windowSeconds * 1000);
    const seconds = Math.ceil((retryAt.getTime() - now.getTime()) / 1000);
    return { seconds: Math.max(1, seconds), message: `You have downloaded several files. Try again after ${ukTimeHM(retryAt)}.` };
  }
  await ctx.db.query("INSERT INTO file_rate (desk_id, at, action) VALUES ($1,NOW(),$2)", [deskId, action]);
  return null;
}
