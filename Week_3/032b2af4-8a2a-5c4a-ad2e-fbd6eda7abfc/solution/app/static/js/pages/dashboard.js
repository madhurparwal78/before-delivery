import { api, requireMember } from "../core/api.js";
import { $, h } from "../core/dom.js";
import { duration, km } from "../core/format.js";
import { toast } from "../core/toast.js";
import { avatar, weeklyChart } from "../components/charts.js";
import { emptyState, feedCard } from "../components/cards.js";

const feed = $("[data-feed]");
const end = $("[data-feed-end]");
const sentinel = $("[data-feed-sentinel]");
let cursor = null;
let loading = false;
let done = false;
let me = null;

function skeleton() {
  return h("div", { class: "card feed-skeleton", "aria-hidden": "true" },
    h("span", { class: "skeleton", style: "height:44px;width:50%" }), h("span", { class: "skeleton", style: "height:140px" }), h("span", { class: "skeleton", style: "height:24px;width:70%" }));
}

async function loadPage() {
  if (!me || loading || done) return;
  loading = true;
  const first = !cursor && !feed.children.length;
  if (first) feed.replaceChildren(skeleton(), skeleton());
  const result = await api(`/api/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  loading = false;
  if (!result.ok) {
    feed.replaceChildren(h("div", { class: "notice is-error", role: "alert" }, "Your feed could not be loaded. Reload the page to try again."));
    done = true;
    return;
  }
  if (first) feed.replaceChildren();
  for (const activity of result.data.activities) feed.append(feedCard(activity, me));
  cursor = result.data.next_cursor;
  if (cursor) {
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  } else {
    done = true;
    observer.disconnect();
    end.replaceChildren(feed.children.length
      ? h("p", { class: "muted center", text: "You're all caught up." })
      : emptyState("Your feed is quiet", "Upload an activity or follow an athlete and it will show up here.", h("a", { class: "btn btn-primary btn-pill", href: "/upload", text: "Upload an activity" })));
  }
}

const observer = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) loadPage();
}, { rootMargin: "600px" });

async function athleteColumn() {
  const [profile, stats] = await Promise.all([api(`/api/athletes/${me.id}`), api("/api/athletes/me/stats")]);
  const card = $("[data-athlete-card]");
  if (profile.ok && stats.ok) {
    const week = stats.data.weeks[stats.data.weeks.length - 1];
    card.replaceChildren(
      avatar(me.name, true),
      h("h2", {}, h("a", { href: `/athletes/${me.id}`, text: me.name })),
      h("dl", { class: "counts" },
        h("div", {}, h("dt", { text: "Following" }), h("dd", { text: String(profile.data.following_count) })),
        h("div", {}, h("dt", { text: "Followers" }), h("dd", { text: String(profile.data.follower_count) }))),
      h("dl", { class: "week-stats" },
        h("div", {}, h("dt", { text: "This week" }), h("dd", { text: `${km(week.distance_m)} km` })),
        h("div", {}, h("dt", { text: "Moving time" }), h("dd", { text: duration(week.moving_time_s) }))));
    $("[data-weekly-chart]").replaceChildren(weeklyChart(stats.data.weeks));
  }
}

async function followRequests() {
  const result = await api("/api/follow-requests");
  const section = $("[data-requests]");
  if (!result.ok || !result.data.requests.length) return;
  const listNode = $("[data-request-list]");
  section.hidden = false;
  for (const request of result.data.requests) {
    const row = h("li", {}, h("strong", { text: request.follower_name }),
      h("div", { class: "request-actions" },
        h("button", { class: "btn btn-primary btn-pill", type: "button", text: "Approve", "aria-label": `Approve ${request.follower_name}`, onclick: () => decide(request, "approve", row) }),
        h("button", { class: "btn btn-outline btn-pill", type: "button", text: "Reject", "aria-label": `Reject ${request.follower_name}`, onclick: () => decide(request, "reject", row) })));
    listNode.append(row);
  }
}

async function decide(request, action, row) {
  const result = await api(`/api/follow-requests/${request.id}/${action}`, { method: "POST" });
  if (result.ok) {
    row.remove();
    toast(`${action === "approve" ? "Approved" : "Rejected"} ${request.follower_name}.`);
    if (!$("[data-request-list]").children.length) $("[data-requests]").hidden = true;
    athleteColumn();
  }
}

observer.observe(sentinel);
requireMember().then((athlete) => {
  me = athlete;
  loadPage();
  athleteColumn();
  followRequests();
});
