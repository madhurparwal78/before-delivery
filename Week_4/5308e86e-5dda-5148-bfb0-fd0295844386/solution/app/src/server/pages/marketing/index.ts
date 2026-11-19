/** Public marketing pages: pure functions from path to rendered page, with no database use. */
import type { RenderedPage } from "../layout.js";
import { contactPage } from "./contact.js";
import { demoPage } from "./demo.js";
import { homePage } from "./home.js";
import { ventureDebtPage, workingCapitalLoansPage } from "./lending-pages.js";
import { pricingPage } from "./pricing.js";
import {
  booksPage,
  businessBankingPage,
  businessPaymentsPage,
  creditPage,
  invoicingPage,
  payrollPage,
  spendManagementPage,
  treasuryPage,
} from "./product-pages.js";

export { notFoundPage } from "./not-found.js";
export { tourCaptions } from "./tour.js";

export const marketingPages: Record<string, () => RenderedPage> = {
  "/": homePage,
  "/business-banking": businessBankingPage,
  "/business-payments": businessPaymentsPage,
  "/credit": creditPage,
  "/treasury": treasuryPage,
  "/invoicing": invoicingPage,
  "/spend-management": spendManagementPage,
  "/payroll": payrollPage,
  "/books": booksPage,
  "/venture-debt": ventureDebtPage,
  "/working-capital-loans": workingCapitalLoansPage,
  "/pricing": pricingPage,
  "/contact": contactPage,
  "/demo": demoPage,
};
