import { api } from "./api.js";
import { effortText, element, initials, kilometres, pathFrom, projector, reducedMotion, startedAt } from "./format.js";

const NS = "http://www.w3.org/2000/svg";

function miniRoute(activity) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 320 90");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Route of ${activity.name}`);
  svg.innerHTML = '<rect width="320" height="90" fill="#f3f1ee" rx="10"></rect>';
  const line = document.createElementNS(NS, "path");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--orange)");
  line.setAttribute("stroke-width", "4");
  line.setAttribute("stroke-linecap", "round");
  svg.append(line);

  const load = async () => {
    const { ok, data } = await api(`/api/activities/${activity.id}/streams`);
    if (!ok || !data.latlng.length) return;
    line.setAttribute("d", pathFrom(data.latlng, projector(data.latlng, 320, 90, 12)));
  };

  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          watcher.disconnect();
          load();
        }
      });
    });
    watcher.observe(svg);
  } else {
    load();
  }
  return svg;
}

export function feedCard(activity, viewerId) {
  const card = element("article", { class: `card feed-card${reducedMotion() ? "" : " rise"}` });
  const head = element("div", { class: "chips", style: "align-items:center" }, [
    element("span", { class: "avatar", "aria-hidden": "true", text: initials(activity.athlete_name) }),
    element("div", {}, [
      element("a", {
        class: "nav-link",
        href: `/athletes/${activity.athlete_id}`,
        text: activity.athlete_name,
        style: "padding-left:0",
      }),
      element("p", { class: "small muted", text: startedAt(activity.start_time) }),
    ]),
  ]);
  const title = element("h3", {}, [
    element("a", { href: `/activities/${activity.id}`, text: activity.name }),
  ]);
  const stats = element("dl", { class: "stat-row" }, [
    element("div", { class: "stat" }, [
      element("dt", { class: "stat-label", text: "Distance" }),
      element("dd", { class: "stat-value tnum", text: `${kilometres(activity.distance_m)} km` }),
    ]),
    element("div", { class: "stat" }, [
      element("dt", { class: "stat-label", text: activity.sport_type === "ride" ? "Speed" : "Pace" }),
      element("dd", { class: "stat-value tnum", text: effortText(activity) }),
    ]),
    element("div", { class: "stat" }, [
      element("dt", { class: "stat-label", text: "Elevation" }),
      element("dd", { class: "stat-value tnum", text: `${activity.elevation_gain_m} m` }),
    ]),
  ]);

  const kudos = element("button", {
    class: "btn btn-outline btn-pill kudos-btn",
    type: "button",
    "aria-pressed": "false",
  });
  const label = element("span", { text: `Give kudos, ${activity.kudos_count}` });
  kudos.append(label);
  const alert = element("p", { class: "alert alert-error", role: "alert", hidden: "hidden" });

  let count = activity.kudos_count;
  let given = false;
  kudos.addEventListener("click", async () => {
    const before = { count, given };
    given = !given;
    count += given ? 1 : -1;
    label.textContent = `Give kudos, ${count}`;
    kudos.setAttribute("aria-pressed", String(given));
    if (!reducedMotion()) {
      kudos.classList.remove("pop");
      void kudos.offsetWidth;
      kudos.classList.add("pop");
    }
    const { ok } = await api(`/api/activities/${activity.id}/kudos`, {
      method: before.given ? "DELETE" : "POST",
    });
    if (!ok) {
      count = before.count;
      given = before.given;
      label.textContent = `Give kudos, ${count}`;
      kudos.setAttribute("aria-pressed", String(given));
      alert.textContent = "Kudos could not be saved";
      alert.hidden = false;
    }
  });

  const counts = element("p", { class: "small muted" }, [
    element("span", { text: `${activity.kudos_count} kudos` }),
    element("span", { text: " · " }),
    element("span", { text: `${activity.comment_count} comments` }),
  ]);

  card.append(head, title, miniRoute(activity), stats, kudos, counts, alert);
  if (activity.athlete_id === viewerId) kudos.disabled = true;
  return card;
}
