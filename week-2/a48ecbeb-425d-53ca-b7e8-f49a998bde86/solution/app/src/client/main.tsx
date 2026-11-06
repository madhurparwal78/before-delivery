import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { CartDrawer } from "./components/CartDrawer";
import { Footer, Header } from "./components/Header";
import { match, useLocation } from "./lib/router";
import { OfficeApp } from "./office/OfficeApp";
import { AccountPage } from "./pages/Account";
import { BoxPage } from "./pages/Box";
import { CheckoutPage } from "./pages/Checkout";
import { FlavourPage } from "./pages/Flavour";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { AccountForm } from "./pages/SignIn";
import { ApplicationPage, ApplyPage, StockistsPage } from "./pages/Stockists";
import { SubscriptionPage } from "./pages/Subscription";
import { ThanksPage } from "./pages/Thanks";
import { CrateDropProvider } from "./state/crate";
import { DrawerProvider } from "./state/drawer";
import { ShopProvider } from "./state/shop";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/storefront.css";
import "./styles/home.css";
import "./styles/shop.css";

function storefrontPage(path: string) {
  if (path === "/") return <Home />;
  if (path === "/box") return <BoxPage />;
  const flavour = match(/^\/flavours\/(guava-lime|yuzu-ginger|passionfruit-basil|cacao-orange)$/, path);
  if (flavour) return <FlavourPage slug={flavour[0]} key={flavour[0]} />;
  if (path === "/checkout") return <CheckoutPage />;
  const thanks = match(/^\/orders\/(CB-\d{6})\/thanks$/, path);
  if (thanks) return <ThanksPage number={thanks[0]} key={thanks[0]} />;
  if (path === "/account") return <AccountPage />;
  const sub = match(/^\/account\/subscriptions\/([^/]+?)(?:\/(pause|swap|cancel|card))?$/, path);
  if (sub) return <SubscriptionPage id={sub[0]} view={(sub[1] as "pause" | "swap" | "cancel" | "card" | undefined) ?? "home"} key={path} />;
  if (path === "/sign-in") return <AccountForm mode="sign-in" key="in" />;
  if (path === "/sign-up") return <AccountForm mode="sign-up" key="up" />;
  if (path === "/stockists") return <StockistsPage />;
  if (path === "/stockists/apply") return <ApplyPage />;
  const application = match(/^\/stockists\/applications\/([^/]+)$/, path);
  if (application) return <ApplicationPage id={application[0]} key={application[0]} />;
  return <NotFound />;
}

function Storefront({ path }: { path: string }) {
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    document.body.classList.remove("paper");
    if (first.current) {
      first.current = false;
      return;
    }
    const heading = main.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [path]);
  return (
    <ShopProvider>
      <DrawerProvider>
        <CrateDropProvider>
          <div id="page" className={path === "/" ? "is-home" : ""}>
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <Header />
            <main id="main" ref={main}>
              {storefrontPage(path)}
            </main>
            <Footer />
          </div>
          <CartDrawer />
        </CrateDropProvider>
      </DrawerProvider>
    </ShopProvider>
  );
}

function App() {
  const { path } = useLocation();
  if (path === "/office" || path.startsWith("/office/")) return <OfficeApp />;
  return <Storefront path={path} />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
