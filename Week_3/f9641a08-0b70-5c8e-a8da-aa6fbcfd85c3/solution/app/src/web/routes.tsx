import type { ReactNode } from "react";
import { Account } from "./pages/Account";
import { Bag } from "./pages/Bag";
import { Care } from "./pages/Care";
import { Checkout } from "./pages/Checkout";
import { Collection } from "./pages/Collection";
import { Compare } from "./pages/Compare";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Order } from "./pages/Order";
import { Product } from "./pages/Product";
import { Register } from "./pages/Register";
import { SignIn } from "./pages/SignIn";
import { Wishlist } from "./pages/Wishlist";

type Match = RegExpMatchArray;

const routes: [RegExp, (match: Match) => ReactNode][] = [
  [/^\/$/, () => <Home />],
  [/^\/collections\/([^/]+)$/, (m) => <Collection key={m[1]} slug={m[1] ?? ""} />],
  [/^\/products\/([^/]+)$/, (m) => <Product key={m[1]} slug={m[1] ?? ""} />],
  [/^\/compare$/, () => <Compare />],
  [/^\/wishlist$/, () => <Wishlist />],
  [/^\/bag$/, () => <Bag />],
  [/^\/checkout\/([^/]+)$/, (m) => <Checkout key={m[1]} id={m[1] ?? ""} />],
  [/^\/orders\/([^/]+)$/, (m) => <Order key={m[1]} number={m[1] ?? ""} />],
  [/^\/account$/, () => <Account />],
  [/^\/sign-in$/, () => <SignIn />],
  [/^\/register$/, () => <Register />],
  [/^\/care$/, () => <Care />],
];

export function renderRoute(path: string): ReactNode {
  for (const [pattern, render] of routes) {
    const match = path.match(pattern);
    if (match) return render(match);
  }
  return <NotFound />;
}
