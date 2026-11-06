import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PublicShell, StaffShell } from "./layout";
import { RouterProvider, match, useRouter } from "./router";
import { AcceptInvitation, ForgotPassword, NotFound, ResetPassword, SignIn } from "./screens/access";
import { AllocationScreen, DropAllocationsScreen, InvoicingScreen, PriceListsScreen } from "./screens/allocations";
import { CalendarScreen } from "./screens/calendar";
import { DropPage } from "./screens/dropPage";
import { DropsScreen, NewDropScreen } from "./screens/drops";
import { MembersScreen, MyStoreScreen } from "./screens/members";
import { LineSheetScreen, LookbookScreen } from "./screens/merch";
import { PlannerScreen } from "./screens/planner";
import { PressScreen, PreviewsScreen } from "./screens/press";
import { ClaimPage, OptInPage, PressPage } from "./screens/publicLinks";
import { StockistScreen, StockistsScreen } from "./screens/stockists";
import { StoryScreen } from "./screens/story";
import { SessionProvider, useSession } from "./session";
import "./styles.css";

type Render = (params: Record<string, string>) => JSX.Element;

const PUBLIC: Array<[string, Render]> = [
  ["/", () => <CalendarScreen />],
  ["/drops/:slug", (p) => <DropPage key={p.slug} slug={p.slug} />],
  ["/claim/:token", (p) => <ClaimPage token={p.token} />],
  ["/waitlist/confirm/:token", (p) => <OptInPage token={p.token} />],
  ["/press/:token", (p) => <PressPage key={p.token} token={p.token} />],
  ["/sign-in", () => <SignIn />],
  ["/forgot-password", () => <ForgotPassword />],
  ["/reset-password/:token", (p) => <ResetPassword token={p.token} />],
  ["/invite/:token", (p) => <AcceptInvitation token={p.token} />],
];

const STAFF: Array<[string, Render]> = [
  ["/studio/drops", () => <DropsScreen />],
  ["/studio/drops/new", () => <NewDropScreen />],
  ["/studio/drops/:id", (p) => <PlannerScreen key={p.id} id={p.id} />],
  ["/studio/drops/:id/allocations", (p) => <DropAllocationsScreen key={p.id} id={p.id} />],
  ["/studio/allocations/:id", (p) => <AllocationScreen key={p.id} id={p.id} />],
  ["/studio/invoicing", () => <InvoicingScreen />],
  ["/studio/price-lists", () => <PriceListsScreen />],
  ["/studio/drops/:id/line-sheet", (p) => <LineSheetScreen key={p.id} id={p.id} />],
  ["/studio/drops/:id/lookbook", (p) => <LookbookScreen key={p.id} id={p.id} />],
  ["/studio/drops/:id/story", (p) => <StoryScreen key={p.id} id={p.id} />],
  ["/studio/press", () => <PressScreen />],
  ["/studio/drops/:id/previews", (p) => <PreviewsScreen key={p.id} id={p.id} />],
  ["/studio/stockists", () => <StockistsScreen />],
  ["/studio/stockists/:id", (p) => <StockistScreen key={p.id} id={p.id} />],
  ["/studio/members", () => <MembersScreen />],
  ["/studio/my-store", () => <MyStoreScreen />],
];

function find(routes: Array<[string, Render]>, path: string): JSX.Element | null {
  for (const [pattern, render] of routes) {
    const params = match(pattern, path);
    if (params) return render(params);
  }
  return null;
}

function Staff({ screen }: { screen: JSX.Element }): JSX.Element | null {
  const { member, loaded } = useSession();
  const { path, search, navigate } = useRouter();
  useEffect(() => {
    if (loaded && !member && location.pathname.startsWith("/studio")) navigate(`/sign-in?next=${encodeURIComponent(path + search)}`, { replace: true });
  }, [loaded, member, path, search, navigate]);
  if (!loaded || !member) return null;
  return <StaffShell key={member.id}>{screen}</StaffShell>;
}

function App(): JSX.Element | null {
  const { path } = useRouter();
  const staff = find(STAFF, path);
  if (staff) return <Staff screen={staff} />;
  return <PublicShell>{find(PUBLIC, path) ?? <NotFound />}</PublicShell>;
}

/** No sticky bar ever covers the control that has focus: scroll it clear of the bar. */
function keepFocusClear(): void {
  document.addEventListener("focusin", (event) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLElement) || target.closest("[data-sticky-bar], dialog")) return;
    const box = target.getBoundingClientRect();
    for (const bar of document.querySelectorAll<HTMLElement>("[data-sticky-bar]")) {
      const b = bar.getBoundingClientRect();
      if (!b.height || getComputedStyle(bar).position === "static") continue;
      if (box.bottom > b.top && box.top < b.bottom) window.scrollBy({ top: box.bottom - b.top + 12, behavior: "instant" });
    }
  });
}

keepFocusClear();

// Every face is fetched before the first paint (at most 1.5 s), so a face first used by data that arrives later
// (the mono numerals in a price table) never swaps in under the reader and shifts the layout.
const FACES = ["600 1em Archivo", "700 1em Archivo", "400 1em Inter", "500 1em Inter", "600 1em Inter", '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const fonts = Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined);
void Promise.race([fonts, new Promise((settle) => window.setTimeout(settle, 1500))]).then(() =>
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <RouterProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </RouterProvider>
    </StrictMode>,
  ),
);
