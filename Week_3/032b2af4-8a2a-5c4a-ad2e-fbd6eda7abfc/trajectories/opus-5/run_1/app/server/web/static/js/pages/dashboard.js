import { api } from "../api.js";
import { feedCard } from "../feed.js";
import { duration, element, initials, kilometres } from "../format.js";

async function athleteCard() {
  const { ok, data } = await api("/api/me");
  if (!ok) {
    window.location.replace("/login");
    return null;
  }
  const me = data.athlete;
  document.querySelector("[data-me-initials]").textContent = initials(me.name);
  document.querySelector("[data-me-name]").textContent = me.name;

  const profile = await api(`/api/athletes/${me.id}`);
  if (profile.ok) {
    document.querySelector("[data-me-following]").textContent = profile.data.following_count;
    document.querySelector("[data-me-followers]").textContent = profile.data.follower_count;
  }
  return me;
}

async function weeklyChart() {
  const { ok, data } = await api("/api/athletes/me/stats?weeks=12");
  if (!ok) return;
  const chart = document.querySelector("[data-weekly-chart]");
  const peak = Math.max(1, ...data.weeks.map((week) => week.distance_m));
  chart.textContent = "";
  data.weeks.forEach((week) => {
    chart.append(
      element("span", {
        class: "bar",
        title: `${week.week_start}: ${kilometres(week.distance_m)} km`,
        style: `height:${Math.max(2, (week.distance_m / peak) * 100)}%`,
      })
    );
  });
  const current = data.weeks[data.weeks.length - 1];
  document.querySelector("[data-week-distance]").textContent = `${kilometres(current.distance_m)} km`;
  document.querySelector("[data-week-time]").textContent = duration(current.moving_time_s);
  document.querySelector("[data-weekly-summary]").textContent =
    `Year to date: ${kilometres(data.year_to_date.distance_m)} km over ${data.year_to_date.activity_count} activities.`;
}

async function followRequests() {
  const section = document.querySelector("[data-follow-requests]");
  const list = document.querySelector("[data-request-list]");
  const { ok, data } = await api("/api/follow-requests");
  if (!ok) return;
  list.textContent = "";
  data.requests.forEach((request) => {
    const decide = async (choice) => {
      await api(`/api/follow-requests/${request.id}/${choice}`, { method: "POST" });
      followRequests();
    };
    const approve = element("button", { class: "btn btn-primary btn-pill", type: "button", text: "Approve" });
    const reject = element("button", { class: "btn btn-outline btn-pill", type: "button", text: "Reject" });
    approve.addEventListener("click", () => decide("approve"));
    reject.addEventListener("click", () => decide("reject"));
    list.append(
      element("li", { class: "card chips", style: "align-items:center;margin-bottom:12px" }, [
        element("span", { class: "avatar", "aria-hidden": "true", text: initials(request.follower_name) }),
        element("a", { href: `/athletes/${request.follower_id}`, text: request.follower_name }),
        approve,
        reject,
      ])
    );
  });
  section.hidden = data.requests.length === 0;
}

function feedLoader(viewerId) {
  const host = document.querySelector("[data-feed]");
  const empty = document.querySelector("[data-feed-empty]");
  const more = document.querySelector("[data-feed-more]");
  const sentinel = document.querySelector("[data-feed-sentinel]");
  const status = document.querySelector("[data-feed-status]");
  let cursor = null;
  let finished = false;
  let busy = false;
  let loaded = 0;

  const loadPage = async () => {
    if (busy || finished) return;
    busy = true;
    const query = cursor ? `/api/feed?limit=10&cursor=${encodeURIComponent(cursor)}` : "/api/feed?limit=10";
    const { ok, data } = await api(query);
    busy = false;
    if (!ok) return;
    data.activities.forEach((activity) => host.append(feedCard(activity, viewerId)));
    loaded += data.activities.length;
    cursor = data.next_cursor;
    finished = !cursor;
    more.hidden = finished;
    empty.hidden = loaded > 0;
    status.textContent = finished ? `${loaded} activities in your feed.` : "";
  };

  more.addEventListener("click", loadPage);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadPage();
    }).observe(sentinel);
  }
  return loadPage;
}

export async function init() {
  const me = await athleteCard();
  if (!me) return;
  await weeklyChart();
  await followRequests();
  const load = feedLoader(me.id);
  await load();
}
