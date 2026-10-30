import type { PoolClient } from "pg";
import { newPassCode } from "../../shared/money.js";
import { buildPassPdf } from "../pdf.js";
import { S3 } from "../s3.js";

export interface PassInfo {
  code: string;
  objectKey: string;
  passId: number;
}

export function passObjectKey(orderRef: string, passCode: string): string {
  return `passes/${orderRef}/${passCode}.pdf`;
}

export interface PassPdfSpec {
  orderRef: string;
  holderName: string;
  itemTitle: string;
  when: string;
  venue: string;
}

// Store a pass PDF privately and create its pass row. The PDF shows only the
// holder, item, time or day, venue and pass code, with a QR of the code.
export async function storePass(
  s3: S3,
  client: PoolClient,
  spec: PassPdfSpec,
  lineId: number,
): Promise<PassInfo> {
  const code = newPassCode();
  const pdf = buildPassPdf({
    holderName: spec.holderName,
    itemTitle: spec.itemTitle,
    when: spec.when,
    venue: spec.venue,
    passCode: code,
  });
  const objectKey = passObjectKey(spec.orderRef, code);
  await s3.put(objectKey, pdf, "application/pdf");
  const res = await client.query(
    "insert into passes (code, line_id, status) values ($1, $2, 'valid') returning id",
    [code, lineId],
  );
  const passId = Number(res.rows[0].id);
  return { code, objectKey, passId };
}

export async function deletePassObject(s3: S3, objectKey: string): Promise<void> {
  await s3.remove(objectKey).catch(() => undefined);
}
