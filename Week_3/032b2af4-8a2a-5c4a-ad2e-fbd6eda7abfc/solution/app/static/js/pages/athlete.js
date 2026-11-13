import { api, requireMember } from "../core/api.js";
import { $, h, s } from "../core/dom.js";
import { shortDate } from "../core/format.js";
import { avatar, weeklyChart } from "../components/charts.js";
import { emptyState, feedCard } from "../components/cards.js";

const root = $("[data-athlete-root]");
const id = location.pathname.split("/").pop();
const PAGE = 20;

function notFound() {
  root.replaceChildren(h("div", { class: "empty-state" }, h("strong", { text: "Athlete not found" }),
    h("p", { text: "This account does not exist, or it has been deleted." }),
    h("a", { class: "btn btn-primary btn-pill", href: "/dashboard", text: "Back to the dashboard" })));
}

const FOLLOW_LABEL = { none: "Follow", pending: "Requested", accepted: "Following" };

function followButton(athlete, onChange) {
  const button = h("button", { class: "btn btn-primary btn-pill", type: "button" });
  const paint = () => {
    button.textContent = FOLLOW_LABEL[athlete.follow_status];
    button.className = `btn btn-pill ${athlete.follow_status === "none" ? "btn-primary" : "btn-outline"}`;
  };
  paint();
  button.addEventListener("click", async () => {
    const following = athlete.follow_status !== "none";
    const result = await api(`/api/athletes/${athlete.id}/follow`, { method: following ? "DELETE" : "POST" });
    if (result.ok) {
      athlete.follow_status = following ? "none" : result.data.status;
      paint();
      onChange();
    }
  });
  return button;
}

function trophyCase(trophies, me) {
  const body = trophies.length
    ? h("ul", { class: "trophy-list" }, ...trophies.map((t) => h("li", { class: "trophy" },
      s("svg", { class: "challenge-badge", viewBox: "0 0 64 64", "aria-hidden": "true", focusable: "false" }, s("circle", { cx: 32, cy: 32, r: 30, fill: "#fff" }), s("path", { d: "m14 44 12-20 8 12 5-7 11 15z", fill: "#D93D00" })),
      h("div", {}, h("strong", { text: t.name }), h("p", { class: "small muted", text: `Completed ${shortDate(t.completed_at, me.time_zone)}` })))))
    : emptyState("No completed challenges yet", "Finish a monthly challenge and its badge lands here.");
  return h("section", { class: "card", "aria-labelledby": "trophy-title" }, h("h2", { id: "trophy-title", class: "card-title", text: "Trophy case" }), body);
}

async function render(athlete, me) {
  const mine = athlete.follow_status === "self";
  const [stats, trophies] = await Promise.all([api(`/api/athletes/${athlete.id}/stats`), api(`/api/athletes/${athlete.id}/trophies`)]);
  const counts = h("dl", { class: "counts" },
    h("div", {}, h("dt", { text: "Followers" }), h("dd", { text: String(athlete.follower_count) })),
    h("div", {}, h("dt", { text: "Following" }), h("dd", { text: String(athlete.following_count) })));
  const refreshCounts = async () => {
    const fresh = await api(`/api/athletes/${athlete.id}`);
    if (fresh.ok) {
      athlete.follower_count = fresh.data.follower_count;
      counts.replaceChildren(...[["Followers", fresh.data.follower_count], ["Following", fresh.data.following_count]].map(([label, n]) => h("div", {}, h("dt", { text: label }), h("dd", { text: String(n) }))));
      await loadActivities(true);
    }
  };
  const list = h("div", { class: "activity-rows" });
  const more = h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Show more", hidden: true });
  let cursor = null;
  async function loadActivities(reset) {
    if (reset) {
      cursor = null;
      list.replaceChildren();
    }
    const result = await api(`/api/athletes/${athlete.id}/activities?limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!result.ok) return;
    for (const activity of result.data.activities) list.append(feedCard(activity, me));
    cursor = result.data.next_cursor;
    more.hidden = !cursor;
    if (!list.children.length) {
      const locked = athlete.private && !mine && athlete.follow_status !== "accepted";
      list.replaceChildren(emptyState(locked ? "This account is private" : "No activities to show", locked ? "Follow this athlete and wait for approval to see their activities." : "Nothing here yet."));
    }
  }
  more.addEventListener("click", () => loadActivities(false));

  root.replaceChildren(
    h("div", { class: "athlete-head" }, avatar(athlete.name, true), h("h1", { text: athlete.name }), counts,
      mine ? null : followButton(athlete, refreshCounts)),
    h("div", { class: "profile-grid" },
      h("section", { class: "card", "aria-labelledby": "weeks-title" }, h("h2", { id: "weeks-title", class: "card-title", text: "Last twelve weeks" }),
        stats.ok ? weeklyChart(stats.data.weeks) : h("p", { class: "muted", text: "Stats are not available." })),
      trophyCase(trophies.ok ? trophies.data.trophies : [], me)),
    h("section", { "aria-labelledby": "activities-title", style: "margin-top:32px" },
      h("h2", { id: "activities-title", class: "card-title", text: "Activities" }), list, h("div", { class: "center-cta" }, more)));
  await loadActivities(true);
}

requireMember().then(async (me) => {
  if (!/^\d{1,18}$/.test(id)) return notFound();
  const result = await api(`/api/athletes/${id}`);
  if (!result.ok) return notFound();
  await render(result.data, me);
  return null;
});
