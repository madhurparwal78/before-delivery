// Browser entry: the layout frame and the page table.
import { mountLayout } from "./layout.ts";
import { startRouter } from "./router.ts";
import { account } from "./pages/account.ts";
import { forgotPassword, login, resetPassword, signup } from "./pages/auth.ts";
import { boards } from "./pages/boards.ts";
import { build } from "./pages/build.ts";
import { callback } from "./pages/callback.ts";
import { cartPage, sharedCart } from "./pages/cart.ts";
import { checkout } from "./pages/checkout.ts";
import { home } from "./pages/home.ts";
import { faq, partners, privacy, protection, shipping } from "./pages/info.ts";
import { events, locations } from "./pages/locations.ts";
import { match } from "./pages/match.ts";
import { notFound } from "./pages/notfound.ts";
import { orderPage } from "./pages/order.ts";
import { foilBoards, parts } from "./pages/shop.ts";
import { staff } from "./pages/staff.ts";
import { contact, support, track } from "./pages/support.ts";
import { tradeIn } from "./pages/tradein.ts";

const root = document.getElementById("app") as HTMLElement;
startRouter(mountLayout(root), {
  "/": home,
  "/boards": boards,
  "/foil-boards": foilBoards,
  "/parts": parts,
  "/match": match,
  "/build": build,
  "/build/:code": build,
  "/cart": cartPage,
  "/cart/shared/:token": sharedCart,
  "/checkout": checkout,
  "/account": account,
  "/account/orders/:number": orderPage,
  "/trade-in": tradeIn,
  "/locations": locations,
  "/events": events,
  "/callback": callback,
  "/track": track,
  "/support": support,
  "/contact": contact,
  "/signup": signup,
  "/login": login,
  "/forgot-password": forgotPassword,
  "/reset-password": resetPassword,
  "/staff": staff,
  "/shipping": shipping,
  "/protection": protection,
  "/faq": faq,
  "/partners": partners,
  "/privacy-policy": privacy,
  notFound,
});
