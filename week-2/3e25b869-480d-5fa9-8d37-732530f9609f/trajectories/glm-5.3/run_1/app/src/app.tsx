// The app shell: header, navigation, language toggle, routing, live regions.
import { render } from "preact";
import { useEffect, useState, useCallback } from "preact/hooks";
import { t, type Locale } from "./state/i18n.js";
import { api, initialLocale, setLocaleCookie } from "./state/api.js";
import { DropPage } from "./pages/drop.js";
import { CheckoutPage, PlacedPage } from "./pages/checkout.js";
import { SubscribePage } from "./pages/subscribe.js";
import { AccountPage, OrderPage, SubscriptionPage } from "./pages/account.js";
import { ContactPage } from "./pages/contact.js";
import { NotFoundPage } from "./pages/notfound.js";
import { StudioPage } from "./pages/studio.js";

export interface PageProps {
  locale: Locale;
  path: string;
  params: Record<string, string>;
  status: ServiceStatus;
  onNavigate: (path: string) => void;
}

export interface ServiceStatus {
  billing: "up" | "down";
  mail: "up" | "down";
}

export function main(): void {
  render(<App />, document.getElementById("root")!);
}

function parseRoute(path: string): { page: string; params: Record<string, string> } {
  const placedMatch = /^\/checkout\/placed\/(PDL-\d{6})$/.exec(path);
  if (placedMatch) return { page: "placed", params: { number: placedMatch[1] } };
  if (path === "/" || path.startsWith("/?")) return { page: "drop", params: {} };
  if (path === "/checkout") return { page: "checkout", params: {} };
  if (path === "/subscribe") return { page: "subscribe", params: {} };
  if (path === "/account") return { page: "account", params: {} };
  if (path === "/contact") return { page: "contact", params: {} };
  if (path === "/studio" || path.startsWith("/studio/")) return { page: "studio", params: { rest: path.slice("/studio".length) } };
  const orderMatch = /^\/account\/orders\/(PDL-\d{6})$/.exec(path);
  if (orderMatch) return { page: "order", params: { number: orderMatch[1] } };
  const subMatch = /^\/account\/subscriptions\/(SUB-\d{6})$/.exec(path);
  if (subMatch) return { page: "subscription", params: { number: subMatch[1] } };
  return { page: "notfound", params: {} };
}

function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale());
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  const [status, setStatus] = useState<ServiceStatus>({ billing: "up", mail: "down" });
  const route = parseRoute(path);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const check = async () => {
      try {
        const data = await api<{ billing: "up" | "down"; mail: "up" | "down" }>("/status");
        setStatus({ billing: data.billing, mail: data.mail });
      } catch {
        // Keep the last known status.
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);

  const navigate = useCallback((next: string) => {
    window.history.pushState(null, "", next);
    setPath(next);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toggleLocale = useCallback(() => {
    const next: Locale = locale === "fr-CA" ? "en-CA" : "fr-CA";
    setLocaleCookie(next);
    setLocale(next);
  }, [locale]);

  const pageProps: PageProps = { locale, path, params: route.params, status, onNavigate: navigate };

  return (
    <>
      <a class="skip-link" href="#main" onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById("main");
        const heading = main?.querySelector("h1") as HTMLElement | null;
        (heading ?? main)?.setAttribute("tabindex", "-1");
        (heading ?? main)?.focus();
      }}>{t("skipToContent", locale)}</a>
      <header class="site-header">
        <a class="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("/"); }}>Pain de Lune</a>
        <nav aria-label={locale === "fr-CA" ? "Principal" : "Main"} class="main-nav">
          <a href="/" aria-current={route.page === "drop" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("/"); }}>{t("navDrop", locale)}</a>
          <a href="/subscribe" aria-current={route.page === "subscribe" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("/subscribe"); }}>{t("navSubscribe", locale)}</a>
          <a href="/account" aria-current={["account", "order", "subscription"].includes(route.page) ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("/account"); }}>{t("navAccount", locale)}</a>
          <a href="/contact" aria-current={route.page === "contact" ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate("/contact"); }}>{t("navContact", locale)}</a>
        </nav>
        <button type="button" class="lang-toggle" onClick={toggleLocale}>{t("languageToggle", locale)}</button>
      </header>
      <div role="status" class="service-status" aria-label={t("serviceStatus", locale)}>
        {(route.page === "drop" || route.page === "checkout")
          ? (status.billing === "down" ? t("outageCheckout", locale) : "")
          : (status.billing === "down" ? t("outageSubscription", locale) : "")}
      </div>
      <main id="main">
        {route.page === "drop" && <DropPage {...pageProps} />}
        {route.page === "checkout" && <CheckoutPage {...pageProps} />}
        {route.page === "placed" && <PlacedPage {...pageProps} />}
        {route.page === "subscribe" && <SubscribePage {...pageProps} />}
        {route.page === "account" && <AccountPage {...pageProps} />}
        {route.page === "order" && <OrderPage {...pageProps} />}
        {route.page === "subscription" && <SubscriptionPage {...pageProps} />}
        {route.page === "contact" && <ContactPage {...pageProps} />}
        {route.page === "studio" && <StudioPage {...pageProps} />}
        {route.page === "notfound" && <NotFoundPage {...pageProps} />}
      </main>
      <footer class="site-footer"><p>Pain de Lune · Montréal</p></footer>
    </>
  );
}

main();
