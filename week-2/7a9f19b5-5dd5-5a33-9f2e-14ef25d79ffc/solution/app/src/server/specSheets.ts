import { variantByCode } from "./catalogue.js";
import { pool } from "./db.js";
import { specSheetPdf } from "./documents.js";
import { notFound } from "./errors.js";
import type { Route } from "./http.js";
import { getObject, putConfirmed } from "./storage.js";

/** Each variant's spec sheet is generated on the first request, stored in MinIO and reused afterwards. */
export const specSheetRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/variants/:code/spec-sheet",
    access: "public",
    async handler({ params }) {
      const variant = await variantByCode(params.code!);
      if (!variant) throw notFound();
      const key = `spec-sheets/${variant.code}.pdf`;
      let file = (await getObject(key))?.data;
      if (!file) {
        const product = await pool.query<{ family: string; watts: number; cri: number; ip_rating: string }>(
          "SELECT family, watts, cri, ip_rating FROM products WHERE slug = $1",
          [variant.product_slug],
        );
        const { family, watts, cri, ip_rating } = product.rows[0]!;
        file = specSheetPdf({ variant, family, watts, cri, ipRating: ip_rating });
        await putConfirmed(key, file, "application/pdf");
      }
      return {
        status: 200,
        file,
        contentType: "application/pdf",
        headers: { "Content-Disposition": `attachment; filename="${variant.code}-spec-sheet.pdf"` },
      };
    },
  },
];
