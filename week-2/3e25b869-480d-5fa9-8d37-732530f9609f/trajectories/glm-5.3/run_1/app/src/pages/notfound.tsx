// The not-found page.
import type { PageProps } from "../app.js";
import { NotFoundContent } from "./checkout.js";

export function NotFoundPage({ locale }: PageProps) {
  return <NotFoundContent locale={locale} />;
}
