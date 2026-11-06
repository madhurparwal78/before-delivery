// The one-page certificate PDFs stored for the seeded documents.

import { buildPdf } from "./pdf.js";
import type { SeedDocument } from "./schema.js";

const HOLDERS: Record<string, string> = {
  "mbr-rosa": "Rosa's Tamal Cart",
  "mbr-crumb": "Northside Crumb Co.",
  "mbr-lake": "Lakefront Meal Prep",
  "usr-tomas": "Tomás Reyes",
  "usr-lena": "Lena Park",
  "usr-abe": "Abe Lindqvist",
};

export function seedCertificatePdf(doc: SeedDocument): Buffer {
  const kind = doc.kind === "food_handler_card" ? "Food handler card" : "Certificate of liability insurance";
  return buildPdf(kind, [
    { text: kind, size: 16, bold: true },
    { text: `Holder: ${HOLDERS[doc.crew ?? doc.member]}`, gap: 8 },
    { text: `Valid through ${doc.expires}`, gap: 4 },
    { text: "Seeded certificate on file at Halsted Street Kitchen.", gap: 4 },
  ]);
}
