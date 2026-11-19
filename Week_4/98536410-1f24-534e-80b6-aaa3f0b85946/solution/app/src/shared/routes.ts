// The screens of the app, who may open them, and where each role lands: one table for the server and the browser.

export type Role = "lead" | "manager" | "care" | "shopper";
export type RouteKind = "public" | "estate" | "shop" | "care" | "care-order" | "catalogue" | "product" | "cart" | "order" | "unknown";

export function classifyRoute(pathname: string): { kind: RouteKind; id: string } {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second, third] = parts;
  if (pathname === "/" || pathname === "/sign-in") return { kind: "public", id: "" };
  if (pathname.endsWith("/")) return { kind: "unknown", id: "" };
  if (parts.length === 1 && first === "estate") return { kind: "estate", id: "" };
  if (parts.length === 2 && first === "shop") return { kind: "shop", id: second ?? "" };
  if (parts.length === 1 && first === "care") return { kind: "care", id: "" };
  if (parts.length === 3 && first === "care" && second === "orders") return { kind: "care-order", id: third ?? "" };
  if (parts.length === 1 && first === "catalogue") return { kind: "catalogue", id: "" };
  if (parts.length === 2 && first === "products") return { kind: "product", id: second ?? "" };
  if (parts.length === 1 && first === "cart") return { kind: "cart", id: "" };
  if (parts.length === 2 && first === "orders") return { kind: "order", id: second ?? "" };
  return { kind: "unknown", id: "" };
}

const ROLE_OF: Partial<Record<RouteKind, Role>> = {
  estate: "lead", shop: "manager", care: "care", "care-order": "care", catalogue: "shopper", product: "shopper", cart: "shopper", order: "shopper",
};

/** The one role that may open this kind of screen, or null for a screen anyone may open. */
export function roleOfRoute(kind: RouteKind): Role | null {
  return ROLE_OF[kind] ?? null;
}

/** A manager lands on the assigned shop with the lowest code. */
export function landingFor(role: Role, shopCodes: string[]): string {
  switch (role) {
    case "lead": return "/estate";
    case "care": return "/care";
    case "shopper": return "/catalogue";
    case "manager": return `/shop/${[...shopCodes].sort()[0]}`;
  }
}
