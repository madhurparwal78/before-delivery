import { createHash } from "node:crypto";

export const sha256Hex = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
