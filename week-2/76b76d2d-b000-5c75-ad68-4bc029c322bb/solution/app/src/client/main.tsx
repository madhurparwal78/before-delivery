import { Fragment, render } from "preact";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";
import type { Account, ServiceStatus } from "../shared/api.ts";
import { isLocale, type Locale } from "../shared/domain.ts";
import { api, setApiLocale } from "./api.ts";
import { Layout } from "./chrome.tsx";
import { App, type AppContext } from "./context.tsx";
import { STRINGS } from "./i18n.ts";
import { AccountPage } from "./pages/account.tsx";
import { SignInPage, SignUpPage } from "./pages/auth.tsx";
import { BookingPage } from "./pages/booking.tsx";
import { CheckoutPage } from "./pages/checkout.tsx";
import { BookingLinkPage, ContactPage } from "./pages/forms.tsx";
import { GiftPage, GiftRedeemPage } from "./pages/gift.tsx";
import { MembershipPage } from "./pages/membership.tsx";
import { NotFoundPage } from "./pages/not-found.tsx";
import { ProgrammePage } from "./pages/programme.tsx";
import { ScreeningPage } from "./pages/screening.tsx";
import { StaffPage } from "./pages/staff.tsx";

function route(rest: string) {
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = parts;
  if (parts.length === 0) return { page: <ProgrammePage />, wide: true };
  if (first === "screenings" && second && parts.length === 2) return { page: <ScreeningPage id={second} /> };
  if (first === "checkout" && second && parts.length === 2) return { page: <CheckoutPage holdId={second} /> };
  if (first === "account" && parts.length === 1) return { page: <AccountPage /> };
  if (first === "account" && second === "bookings" && third && parts.length === 3) return { page: <BookingPage source={{ kind: "account", ref: third }} /> };
  if (first === "b" && second && parts.length === 2) return { page: <BookingPage source={{ kind: "guest", token: second }} /> };
  if (first === "membership" && parts.length === 1) return { page: <MembershipPage /> };
  if (first === "gift" && parts.length === 1) return { page: <GiftPage /> };
  if (first === "gift" && second && parts.length === 2) return { page: <GiftRedeemPage token={second} /> };
  if (first === "signin" && parts.length === 1) return { page: <SignInPage /> };
  if (first === "signup" && parts.length === 1) return { page: <SignUpPage /> };
  if (first === "booking-link" && parts.length === 1) return { page: <BookingLinkPage /> };
  if (first === "contact" && parts.length === 1) return { page: <ContactPage /> };
  if (first === "staff" && parts.length === 1) return { page: <StaffPage />, wide: true };
  return { page: <NotFoundPage /> };
}

function Root({ initial }: { initial: Locale }) {
  const [locale, setLocale] = useState<Locale>(initial);
  const [me, setMe] = useState<Account | null | undefined>(undefined);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [path, setPath] = useState(location.pathname);
  setApiLocale(locale);

  const refreshMe = () => {
    void api<{ account: Account }>("GET", "/api/me").then((r) => setMe(r.ok ? r.data.account : null));
  };
  useLayoutEffect(() => {
    refreshMe();
    const poll = () => {
      const sent = Date.now();
      void api<ServiceStatus>("GET", "/api/status").then((r) => {
        if (!r.ok) return;
        setStatus(r.data);
        setServerOffset(Date.parse(r.data.checked_at) - Math.round((sent + Date.now()) / 2));
      });
    };
    poll();
    const timer = setInterval(poll, 5000);
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => {
      clearInterval(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const navigate = (to: string) => {
    const target = to.split("/")[1]?.split(/[?#]/)[0];
    if (!isLocale(target)) {
      location.assign(to);
      return;
    }
    history.pushState(null, "", to);
    document.documentElement.lang = target;
    setApiLocale(target);
    setLocale(target);
    window.scrollTo(0, 0);
    setMe(undefined);
    refreshMe();
    setPath(location.pathname);
  };

  /** In-place language switch (brief: Language switch): nothing reloads, the prefix is replaced, the choice is saved. */
  const switchLocale = (next: Locale) => {
    const rest = location.pathname.replace(/^\/(en|fr)(?=\/|$)/, "");
    history.replaceState(history.state, "", `/${next}${rest || "/"}${location.search}${location.hash}`);
    document.documentElement.lang = next;
    document.documentElement.dataset["locale"] = next;
    setApiLocale(next);
    setLocale(next);
    void api("POST", "/api/locale", { locale: next });
  };

  const ctx: AppContext = { locale, t: STRINGS[locale], me, refreshMe, status, serverOffset, navigate };
  const rest = path.replace(/^\/(en|fr)(?=\/|$)/, "");
  const { page, wide } = useMemo(() => route(rest), [rest]);
  return (
    <App.Provider value={ctx}>
      <Layout onSwitch={switchLocale} wide={wide ?? false}><Fragment key={rest}>{page}</Fragment></Layout>
    </App.Provider>
  );
}

const prefix = location.pathname.split("/")[1];
const initial: Locale = isLocale(prefix) ? prefix : "en";
document.documentElement.lang = initial;
const mount = document.getElementById("app");
if (mount) render(<Root initial={initial} />, mount);
