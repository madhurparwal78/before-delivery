/** Page routes of the app: the server answers 404 for anything else, the client renders these. */
const PAGE_ROUTES = [
  "/",
  "/search",
  "/p/:id",
  "/p/:id/offers",
  "/compare",
  "/cart",
  "/checkout/address",
  "/checkout/payment",
  "/checkout/review",
  "/orders/:id/placed",
  "/orders",
  "/orders/:id",
  "/wishlist",
  "/s/:token",
  "/signin",
  "/signin/code",
  "/signup",
  "/signup/code",
  "/forgot",
  "/account",
  "/seller/listings",
  "/seller/listings/new",
  "/seller/listings/:id",
  "/seller/stock",
  "/seller/shipments",
  "/seller/returns",
  "/seller/statement",
  "/support",
  "/support/orders/:id",
] as const;

export function isPageRoute(path: string): boolean {
  return PAGE_ROUTES.some((pattern) => {
    const regex = new RegExp(`^${pattern.replace(/:[a-z]+/g, "[^/]+")}/?$`);
    return regex.test(path);
  });
}
