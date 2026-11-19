import { useEffect, useSyncExternalStore } from "react";
import type { Value } from "../../../shared/expression.js";
import { ApiFailure, get } from "../../lib/api.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { loadingScreen, type Loaded } from "../../lib/ui.js";
import { NotFound } from "../NotFound.js";

export interface CartLine {
  id: number;
  item: string;
  quantity: number;
  variables: Record<string, Value>;
}

interface CartStore {
  owner: string | null;
  count: number | null;
}

let cart: CartStore = { owner: null, count: null };
const listeners = new Set<() => void>();

function publishCart(next: CartStore): void {
  cart = next;
  listeners.forEach((listener) => listener());
}

/** Reads the cart again and tells every cart link the new line count. */
export async function refreshCart(owner: string): Promise<CartLine[]> {
  const { lines } = await get<{ lines: CartLine[] }>("/api/cart");
  publishCart({ owner, count: lines.length });
  return lines;
}

function useCartCount(owner: string): number | null {
  useEffect(() => {
    void refreshCart(owner);
  }, [owner]);
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => cart,
  );
  return snapshot.owner === owner ? snapshot.count : null;
}

/** The orange strip under the pinned subject: the way back to the desk, the fault link and the live cart link. */
export function PortalActions({ home = false }: { home?: boolean }): JSX.Element {
  const session = useSession();
  const count = useCartCount(session.user?.username ?? "");
  return (
    <div className="portal-actions">
      {home ? (
        <Link to="/portal/fault" className="btn btn-solid">
          Report a fault
        </Link>
      ) : (
        <Link to="/portal" className="btn btn-outline">
          Ask the desk
        </Link>
      )}
      {count === null ? (
        // Holds the cart link's place until the count arrives, so the strip never grows a row under the page.
        <span className="btn btn-outline cart-pending" aria-hidden="true">
          Cart, 0 items
        </span>
      ) : (
        <Link to="/portal/cart" className="btn btn-outline">
          Cart, {count} items
        </Link>
      )}
    </div>
  );
}

/** The pinned loading or error line; an unknown or forbidden record shows the not-found state. */
export function gate(state: Exclude<Loaded<unknown>, { status: "ready" }>, subject: string, retry: () => void): JSX.Element {
  if (state.status === "error" && state.error instanceof ApiFailure && state.error.status === 404) return <NotFound />;
  return loadingScreen(state, subject, retry)!;
}
