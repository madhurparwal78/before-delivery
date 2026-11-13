import { route, render, navigate } from "./router.js";
import { el } from "./dom.js";
import { homePage, plansPage } from "./pages-public.js";
import { markersPage, joinPage, signInPage } from "./pages-markers.js";
import { memberHome, membershipPage, memberDrawsPage, memberDrawDetail, memberResultsPage, memberPlanPage, memberMessagesPage, memberRecordsPage, memberAccountPage } from "./pages-member.js";
import { staffMembersPage, staffMemberPage, staffCalendarPage, staffDrawPage, staffResultsQueuePage, staffRangeTablePage, staffReceiptsPage, staffTeamPage, staffMessagesPage, staffMemberPlanPage, staffMemberBlendPage, staffMemberResultsPage, staffMemberMessagesPage, staffPlanDetailPage, staffBlendDetailPage } from "./pages-staff.js";
import { visitPage } from "./pages-visit.js";
import { loadSession } from "./shell.js";

route("/", () => homePage());
route("/plans", () => plansPage());
route("/markers", () => markersPage());
route("/join", () => joinPage());
route("/signin", () => signInPage());

route("/me", async () => (await guardMember()) ?? memberHome());
route("/me/membership", async () => (await guardMember()) ?? membershipPage());
route("/me/draws", async () => (await guardMember()) ?? memberDrawsPage());
route("/me/draws/:drawId", async (params) => (await guardMember()) ?? memberDrawDetail(params["drawId"] ?? ""));
route("/me/results", async () => (await guardMember()) ?? memberResultsPage());
route("/me/plan", async () => (await guardMember()) ?? memberPlanPage());
route("/me/messages", async () => (await guardMember()) ?? memberMessagesPage());
route("/me/records", async () => (await guardMember()) ?? memberRecordsPage());
route("/me/account", async () => (await guardMember()) ?? memberAccountPage());

route("/receipts/:receiptId", async (params) => (await guardReceipt()) ?? receiptPage(params["receiptId"] ?? ""));

route("/staff/members", async () => (await guardStaff()) ?? staffMembersPage());
route("/staff/members/:memberId", async (params) => (await guardStaff()) ?? staffMemberPage(params["memberId"] ?? ""));
route("/staff/members/:memberId/results", async (params) => (await guardStaff(["owner", "specialist", "coordinator"])) ?? staffMemberResultsPage(params["memberId"] ?? ""));
route("/staff/members/:memberId/plan", async (params) => (await guardStaff(["owner", "specialist"])) ?? staffMemberPlanPage(params["memberId"] ?? ""));
route("/staff/members/:memberId/plans/:planId", async (params) => (await guardStaff(["owner", "specialist"])) ?? staffPlanDetailPage(params["memberId"] ?? "", params["planId"] ?? ""));
route("/staff/members/:memberId/blend", async (params) => (await guardStaff(["owner", "specialist"])) ?? staffMemberBlendPage(params["memberId"] ?? ""));
route("/staff/members/:memberId/blends/:blendId", async (params) => (await guardStaff(["owner", "specialist"])) ?? staffBlendDetailPage(params["memberId"] ?? "", params["blendId"] ?? ""));
route("/staff/members/:memberId/messages", async (params) => (await guardStaff(["owner", "specialist", "coordinator"])) ?? staffMemberMessagesPage(params["memberId"] ?? ""));
route("/staff/messages", async () => (await guardStaff(["owner", "specialist", "coordinator"])) ?? staffMessagesPage());
route("/staff/calendar", async () => (await guardStaff(["owner", "coordinator"])) ?? staffCalendarPage());
route("/staff/draws/:drawId", async (params) => (await guardStaff(["owner", "specialist", "coordinator"])) ?? staffDrawPage(params["drawId"] ?? ""));
route("/staff/results", async () => (await guardStaff(["owner", "specialist"])) ?? staffResultsQueuePage());
route("/staff/ranges", async () => (await guardStaff(["owner"])) ?? staffRangeTablePage());
route("/staff/receipts", async () => (await guardStaff(["owner", "billingLead"])) ?? staffReceiptsPage());
route("/staff/team", async () => (await guardStaff(["owner"])) ?? staffTeamPage());

route("/visit/:token", (params) => visitPage(params["token"] ?? ""));

route("(.*)", async () => notFoundPage());

async function guardMember(): Promise<HTMLElement | null> {
  const session = await loadSession();
  if (session && session.role === "member") return null;
  navigate("/signin");
  return el("div");
}

async function guardStaff(roles?: string[]): Promise<HTMLElement | null> {
  const session = await loadSession();
  if (!session || session.role === "member") {
    navigate("/signin");
    return el("div");
  }
  if (roles && !roles.includes(session.role)) {
    navigate(session.home);
    return el("div");
  }
  return null;
}

async function guardReceipt(): Promise<HTMLElement | null> {
  const session = await loadSession();
  if (!session) {
    navigate("/signin");
    return el("div");
  }
  return null;
}

async function receiptPage(receiptId: string): Promise<HTMLElement> {
  const { receiptDetail } = await import("./pages-receipt.js");
  return receiptDetail(receiptId);
}

function notFoundPage(): HTMLElement {
  const main = el("main", { class: "page narrow" });
  main.append(el("h1", { class: "page-title" }, "We can't find that page."));
  const link = el("a", { href: "/", class: "button primary" }, "Go to the home page");
  main.append(el("p", {}, "The address may be mistyped, or the page has moved."));
  const wrapper = el("div", { class: "screen" }, main, el("div", { class: "bottom-bar" }, link));
  wrapper.setAttribute("data-not-found", "true");
  return wrapper;
}

renderInitial();

async function renderInitial(): Promise<void> {
  await render();
  if (document.querySelector(".screen") === null) {
    const root = document.getElementById("root");
    root?.replaceChildren(notFoundPage());
  }
}

