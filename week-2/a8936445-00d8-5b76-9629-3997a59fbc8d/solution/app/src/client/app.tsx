// The shell: session bootstrap, routing by role, the top bar and the status line.
import { LogOut, Menu } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import type { User } from "../shared/api";
import { PRODUCT_NAME } from "../shared/kitchen";
import { hhmm, kitchenParts } from "../shared/time";
import { api, apiNoContent, serverNow } from "./api";
import { act, feedback, whenSessionEnds } from "./feedback";
import { SCREENS, navigate, route, session } from "./router";
import { BillingScreen } from "./screens/Billing";
import { BookingsScreen } from "./screens/Bookings";
import { DialScreen } from "./screens/Dial";
import { DocumentsScreen } from "./screens/Documents";
import { InspectScreen } from "./screens/Inspect";
import { SettingsScreen } from "./screens/Settings";
import { SignInScreen } from "./screens/SignIn";
import { TenantsScreen } from "./screens/Tenants";
import { useStore } from "./store";
import { StatusLine } from "./ui/parts";

whenSessionEnds(() => {
  session.set(null);
  navigate("/signin");
});

export function App() {
  const path = useStore(route);
  const user = useStore(session);
  const inspecting = path.startsWith("/inspect/");

  useEffect(() => {
    if (inspecting || user !== undefined) return;
    void act({ error: () => false, own401: true }, () => api<{ user: User }>("GET", "/api/session")).then((outcome) => {
      session.set(outcome.ok ? outcome.value.user : null);
    });
  }, [inspecting, user]);

  useEffect(() => {
    if (inspecting || user === undefined) return;
    if (user === null && path !== "/signin") navigate("/signin", true);
    if (user && path === "/signin") navigate("/", true);
    if (user && path !== "/signin" && !SCREENS.some((s) => s.path === path && s.roles.includes(user.role))) {
      navigate("/", true);
    }
  }, [inspecting, user, path]);

  if (inspecting) return <InspectScreen token={decodeURIComponent(path.slice("/inspect/".length))} />;
  if (user === undefined) return <StatusLine />;
  if (user === null) return <SignInScreen />;
  const screen = SCREENS.find((s) => s.path === path && s.roles.includes(user.role)) ?? SCREENS[0];
  return (
    <>
      <TopBar user={user} current={screen.path} />
      <StatusLine />
      <main class="content" id="main">
        {screen.path === "/" && <DialScreen user={user} />}
        {screen.path === "/bookings" && <BookingsScreen user={user} />}
        {screen.path === "/documents" && <DocumentsScreen user={user} />}
        {screen.path === "/billing" && <BillingScreen user={user} />}
        {screen.path === "/tenants" && <TenantsScreen />}
        {screen.path === "/settings" && <SettingsScreen />}
      </main>
    </>
  );
}

function KitchenClock() {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = setTimeout(() => setNow(serverNow()), 60_000 - (serverNow() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, [now]);
  useEffect(() => feedback.subscribe(() => setNow(serverNow())), []);
  const minute = kitchenParts(now).minute;
  return (
    <p class="kitchen-clock">
      Kitchen time <time class="mono">{hhmm(minute)}</time>
    </p>
  );
}

function TopBar({ user, current }: { user: User; current: string }) {
  const [open, setOpen] = useState(false);
  const signOut = async (): Promise<void> => {
    await act({ error: () => false }, () => apiNoContent("DELETE", "/api/session"));
    session.set(null);
    navigate("/signin");
  };
  return (
    <header class="topbar">
      <a class="brand" href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
        {PRODUCT_NAME}
      </a>
      <KitchenClock />
      <button
        type="button"
        class="btn btn-quiet menu-button"
        aria-expanded={open ? "true" : "false"}
        aria-controls="main-menu"
        onClick={() => setOpen(!open)}
      >
        <Menu size={18} aria-hidden="true" />
        Menu
      </button>
      <div class={open ? "menu-panel open" : "menu-panel"} id="main-menu">
        <nav aria-label="Main" class="main-nav">
          {SCREENS.filter((s) => s.roles.includes(user.role)).map((s) => (
            <a
              key={s.path}
              href={s.path}
              aria-current={s.path === current ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                setOpen(false);
                navigate(s.path);
              }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <button type="button" class="btn btn-quiet sign-out" onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </header>
  );
}
