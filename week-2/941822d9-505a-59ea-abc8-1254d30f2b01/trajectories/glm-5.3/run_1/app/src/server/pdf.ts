import PDFDocument from "pdfkit";
import { PROVIDER } from "./config.ts";

export type CertificatePdfData = {
  nurseName: string;
  courseTitle: string;
  hours: string;
  serial: string;
  issuedOn: string;
  version: number;
  state: string;
};

const fontDir = (): string => new URL("./fonts/", import.meta.url).pathname;

export function buildCertificatePdf(data: CertificatePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 72 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const serif = `${fontDir()}newsreader.ttf`;
      const sans = `${fontDir()}publicsans.ttf`;

      doc.font(serif).fontSize(26).text("Certificate of Completion", { align: "center" });
      doc.moveDown(0.5);
      doc.font(sans).fontSize(10).fillColor("#444").text(PROVIDER.name.toUpperCase(), { align: "center" });
      doc.moveUp();
      doc.font(sans).fontSize(8).fillColor("#666").text(data.state === "revoked" ? "REVOKED" : "", { align: "right" });
      doc.moveDown(1.5);

      doc.font(sans).fontSize(9).fillColor("#666").text("This certifies that", { align: "center" });
      doc.moveDown(0.4);
      doc.font(serif).fontSize(22).fillColor("#111").text(data.nurseName, { align: "center" });
      doc.moveDown(0.6);
      doc.font(sans).fontSize(9).fillColor("#666").text("has completed the accredited continuing education activity", { align: "center" });
      doc.moveDown(0.4);
      doc.font(serif).fontSize(16).fillColor("#111").text(data.courseTitle, { align: "center" });
      doc.moveDown(1);

      const label = (text: string): void => {
        doc.font(sans).fontSize(8).fillColor("#666").text(text);
      };
      const value = (text: string): void => {
        doc.font(serif).fontSize(12).fillColor("#111").text(text);
      };
      const y = doc.y;
      const colWidth = (doc.page.width - 144) / 2;
      const left = 72;
      const right = 72 + colWidth;

      doc.y = y + 24;
      doc.x = left;
      label("Contact hours");
      value(`${data.hours} contact hours`);

      doc.x = right;
      doc.y = y + 24;
      label("Serial");
      value(data.serial);

      doc.x = left;
      doc.y = y + 84;
      label("Issue date");
      value(data.issuedOn);

      doc.x = right;
      doc.y = y + 84;
      label("Status");
      value(data.state === "revoked" ? "Revoked" : "Sealed");

      doc.x = left;
      doc.y = y + 144;
      doc.font(sans).fontSize(7.5).fillColor("#777").text(`Version ${data.version}`);
      doc.x = 72;
      doc.y = doc.page.height - 140;
      doc.font(sans).fontSize(8).fillColor("#666").text(PROVIDER.accreditation, { align: "center", width: doc.page.width - 144 });

      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}
