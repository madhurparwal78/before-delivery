import type { Request } from "express";
import type { Ctx } from "./app.js";

export interface AuthedRequest extends Request {
  ctx: Ctx;
  deskId: string;
  authEnded?: boolean;
}
