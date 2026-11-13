import { api } from "../api.js";
import { feedCard } from "../feed.js";
import { element, initials, kilometres } from "../format.js";

const FOLLOW_LABELS = { none: "Follow", pending: "Requested", accepted: "Following", self: "This is you" };

export async function init() {
  const page = document.querySelector("[data-athlete-page]");
  const id = page.dataset.athleteId;
  const me = await api("/api/me");
  if (!me.ok) {
    window.location.replace("/login");
    return;
  }
  const viewerId = me.data.athlete.id;

  const profile = await api(`/api/athletes/${id}`);
  if (!profile.ok) {
    document.querySelector("[data-profile-name]").textContent = "Athlete not found";
    return;
  }
  const athlete = profile.data;
  document.querySelector("[data-profile-initials]").textContent = initials(athlete.name);
  document.querySelector("[data-profile-name]").textContent = athlete.name;
  document.title = `${athlete.name} — Pacely`;
  document.querySelector("[data-profile-followers]").textContent = athlete.follower_count;
  document.querySelector("[data-profile-following]").textContent = athlete.following_count;

  const button = document.querySelector("[data-follow-button]");
  const status = document.querySelector("[data-profile-status]");
  let state = athlete.follow_status;
  button.textContent = FOLLOW_LABELS[state];
  button.disabled = state === "self";
  button.addEventListener("click", async () => {
    if (state === "none") {
      const { ok, data } = await api(`/api/athletes/${id}/follow`, { method: "POST" });
      if (ok) {
        state = data.status;
        button.textContent = FOLLOW_LABELS[state];
        status.textContent = state === "pending" ? "Your follow request is waiting for approval." : "";
      }
      return;
    }
    const { ok } = await api(`/api/athletes/${id}/follow`, { method: "DELETE" });
    if (ok) {
      state = "none";
      button.textContent = FOLLOW_LABELS.none;
      status.textContent = "";
    }
  });

  const chartSection = document.querySelector("[data-weekly-section]");
  if (String(viewerId) === String(id)) {
    const stats = await api("/api/athletes/me/stats?weeks=12");
    if (stats.ok) {
      chartSection.hidden = false;
      const chart = document.querySelector("[data-weekly-chart]");
      const peak = Math.max(1, ...stats.data.weeks.map((week) => week.distance_m));
      stats.data.weeks.forEach((week) =>
        chart.append(
          element("span", {
            class: "bar",
            title: `${week.week_start}: ${kilometres(week.distance_m)} km`,
            style: `height:${Math.max(2, (week.distance_m / peak) * 100)}%`,
          })
        )
      );
    }
  }

  const trophies = await api(`/api/athletes/${id}/trophies`);
  const trophyList = document.querySelector("[data-trophies]");
  if (trophies.ok) {
    trophies.data.trophies.forEach((challenge) =>
      trophyList.append(
        element("li", { class: "card" }, [
          element("span", { class: "badge-round", "aria-hidden": "true", text: "★" }),
          element("h3", { style: "font-size:18px", text: challenge.name }),
          element("p", { class: "small muted", text: "Completed" }),
        ])
      )
    );
    document.querySelector("[data-trophies-empty]").hidden = trophies.data.trophies.length > 0;
  }

  const activities = await api(`/api/athletes/${id}/activities?limit=20`);
  const host = document.querySelector("[data-athlete-feed]");
  if (activities.ok) {
    activities.data.activities.forEach((activity) => host.append(feedCard(activity, viewerId)));
    document.querySelector("[data-athlete-feed-empty]").hidden = activities.data.activities.length > 0;
  }
}
