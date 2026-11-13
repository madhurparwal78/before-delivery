import { randomBytes } from "node:crypto";

export const newId = (): string => randomBytes(12).toString("base64url");
export const newToken = (): string => randomBytes(24).toString("base64url");
