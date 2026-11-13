import { h, icon, s } from "../core/dom.js";
import { dateTime, km, pace, SPORT_NAMES, thousands } from "../core/format.js";
import { avatar } from "./charts.js";
import { kudosButton } from "./social.js";
import { routeMap } from "./route-map.js";

/** The headline pace or speed of an activity: pace for runs, walks and hikes, speed for rides. */
export function paceFigure(activity) {
  return activity.sport_type === "ride"
    ? { label: "Speed", value: `${activity.avg_speed_kmh.toFixed(1)} km/h` }
    : { label: "Pace", value: pace(activity.avg_pace_s_per_km) };
}

/** A feed card: athlete, start time, name, a small route drawing, the figures, kudos and comments. */
export function feedCard(activity, me) {
  const mine = activity.athlete_id === me.id;
  const { label, value } = paceFigure(activity);
  const art = routeMap(activity.route, { width: 320, height: 140, compact: true, label: `Route of ${activity.name}`, seed: String(activity.id), id: `card-${activity.id}` }).svg;
  return h("article", { class: "card feed-card" },
    h("header", { class: "feed-head" }, avatar(activity.athlete_name),
      h("div", {}, h("a", { href: `/athletes/${activity.athlete_id}`, text: activity.athlete_name }),
        h("span", { class: "small muted", text: dateTime(activity.start_time, me.time_zone) }))),
    h("div", {}, h("h2", { class: "feed-title" }, h("a", { href: `/activities/${activity.id}`, text: activity.name })),
      h("span", { class: "sport-line" }, icon(activity.sport_type), SPORT_NAMES[activity.sport_type])),
    art,
    h("dl", { class: "stat-row" },
      h("div", {}, h("dt", { text: "Distance" }), h("dd", { text: `${km(activity.distance_m)} km` })),
      h("div", {}, h("dt", { text: label }), h("dd", { text: value })),
      h("div", {}, h("dt", { text: "Elev" }), h("dd", { text: `${thousands(activity.elevation_gain_m)} m` }))),
    h("div", { class: "feed-foot" },
      mine ? h("span", { class: "count-pill" }, icon("thumb"), `${activity.kudos_count} kudos`) : kudosButton(activity),
      h("a", { class: "count-pill", href: `/activities/${activity.id}#comments`, "aria-label": `${activity.comment_count} comments` }, icon("comment"), String(activity.comment_count))));
}



/** A small drawing for the empty states: a dotted route that goes nowhere yet. */
export function emptyDrawing() {
  return s("svg", { viewBox: "0 0 120 72", "aria-hidden": "true", focusable: "false" },
    s("rect", { width: 120, height: 72, rx: 12, fill: "#F3F2EF" }),
    s("path", { d: "M14 54 C 34 54, 36 22, 60 28 S 90 50, 104 18", fill: "none", stroke: "#D93D00", "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": "1 9" }),
    s("circle", { cx: 14, cy: 54, r: 5, fill: "#4A6B00" }));
}

export function emptyState(title, body, action) {
  return h("div", { class: "empty-state" }, emptyDrawing(), h("strong", { text: title }), h("p", { text: body }), action);
}
