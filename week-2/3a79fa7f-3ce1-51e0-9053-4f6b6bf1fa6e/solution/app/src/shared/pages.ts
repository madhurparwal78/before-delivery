// The storefront's page addresses (brief: Screens and layout); anything else is the 404 page.
const PAGES = [
  "/", "/boards", "/foil-boards", "/parts", "/match", "/build", "/build/:code", "/cart", "/cart/shared/:token", "/checkout",
  "/account", "/account/orders/:number", "/trade-in", "/locations", "/events", "/callback", "/track", "/support", "/contact",
  "/signup", "/login", "/forgot-password", "/reset-password", "/staff", "/shipping", "/protection", "/faq", "/partners",
  "/privacy-policy",
] as const;
export type Page = (typeof PAGES)[number];

export function matchPage(path: string): { page: Page; params: Record<string, string> } | null {
  const parts = path.replace(/\/+$/, "").split("/").slice(1);
  for (const page of PAGES) {
    const want = page === "/" ? [] : page.split("/").slice(1);
    if (want.length !== (parts.length === 1 && parts[0] === "" ? 0 : parts.length)) continue;
    const params: Record<string, string> = {};
    const fits = want.every((segment, i) => {
      const actual = parts[i] ?? "";
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(actual);
        return actual !== "";
      }
      return segment === actual;
    });
    if (fits) return { page, params };
  }
  return null;
}
