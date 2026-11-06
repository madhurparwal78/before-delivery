import { PoolClient } from "pg";

export type PhotoStage = "checkout" | "return";

export const PHOTO_LIMIT = 4;
export const PHOTO_MAX_BYTES = 5000000;

/** The one photo-stage rule: checkout while out or overdue, return while returned. */
export function stageForLoanStatus(status: "out" | "returned" | "inspected" | "settled"): PhotoStage | null {
  if (status === "out") return "checkout";
  if (status === "returned") return "return";
  return null;
}

export type DetectedImageType = { contentType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" };

/** The type is judged only by the file's first bytes; the declared type and file name are ignored. */
export function detectImageType(bytes: Buffer): DetectedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

export async function countPhotosForStage(client: PoolClient, loanId: string, stage: PhotoStage): Promise<number> {
  const result = await client.query(
    "SELECT count(*)::int AS count FROM photos WHERE loan_id = $1 AND stage = $2",
    [loanId, stage],
  );
  return result.rows[0].count as number;
}
