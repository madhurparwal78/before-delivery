import { h, s } from "../core/dom.js";
import { initials, km, thousands } from "../core/format.js";

/** Twelve weekly bars of distance; weeks come from the stats route, oldest first. */
export function weeklyChart(weeks) {
  const width = 280, height = 140, top = 12, bottom = 26;
  const most = Math.max(...weeks.map((w) => w.distance_m), 1);
  const slot = width / weeks.length;
  const total = weeks.reduce((sum, w) => sum + w.distance_m, 0);
  const svg = s("svg", { class: "weekly-chart", viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": `Distance per week over the last ${weeks.length} weeks, ${km(total)} km in total` });
  weeks.forEach((week, i) => {
    const barHeight = Math.max(2, (week.distance_m / most) * (height - top - bottom));
    const x = i * slot + slot * 0.18;
    svg.append(s("rect", { class: `bar${week.distance_m ? "" : " is-empty"}`, x, y: height - bottom - barHeight, width: slot * 0.64, height: barHeight, rx: 3 },
      s("title", {}, `Week of ${week.week_start}: ${km(week.distance_m)} km`)));
    if (i % 3 === 0 || i === weeks.length - 1) {
      const label = new Date(`${week.week_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const anchor = i === 0 ? "start" : i === weeks.length - 1 ? "end" : "middle";
      svg.append(s("text", { class: "chart-axis", x: i === 0 ? x : i === weeks.length - 1 ? x + slot * 0.64 : x + slot * 0.32, y: height - 8, "text-anchor": anchor }, label));
    }
  });
  svg.append(s("line", { x1: 0, x2: width, y1: height - bottom, y2: height - bottom, stroke: "#E5E3DE" }));
  return svg;
}

/** The elevation profile: an area chart of altitude over distance with a movable cursor. */
export function elevationProfile(distance, altitude, { width = 640, height = 160 } = {}) {
  const left = 38, right = 12, top = 14, bottom = 26;
  const maxD = Math.max(distance[distance.length - 1], 1);
  const low = Math.min(...altitude), high = Math.max(...altitude, low + 1);
  const x = (d) => left + (d / maxD) * (width - left - right);
  const y = (a) => top + (1 - (a - low) / (high - low)) * (height - top - bottom);
  const line = distance.map((d, i) => `${i ? "L" : "M"}${x(d).toFixed(1)} ${y(altitude[i]).toFixed(1)}`).join("");
  const svg = s("svg", { class: "profile-chart", viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": `Elevation profile from ${Math.round(low)} to ${Math.round(high)} metres over ${km(maxD)} km` });
  svg.append(s("path", { d: `${line}L${x(maxD)} ${height - bottom}L${left} ${height - bottom}Z`, fill: "#D93D00", opacity: "0.14" }));
  svg.append(s("path", { d: line, fill: "none", stroke: "#D93D00", "stroke-width": 2.5, "stroke-linejoin": "round" }));
  svg.append(s("line", { x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, stroke: "#E5E3DE" }));
  svg.append(s("text", { class: "chart-axis", x: left - 6, y: top + 8, "text-anchor": "end" }, `${thousands(Math.round(high))} m`));
  svg.append(s("text", { class: "chart-axis", x: left - 6, y: height - bottom, "text-anchor": "end" }, `${thousands(Math.round(low))} m`));
  svg.append(s("text", { class: "chart-axis", x: left, y: height - 8 }, "0 km"));
  svg.append(s("text", { class: "chart-axis", x: width - right, y: height - 8, "text-anchor": "end" }, `${km(maxD)} km`));
  const cursor = s("line", { y1: top, y2: height - bottom, stroke: "#1E1B18", "stroke-width": 1.5 });
  const dot = s("circle", { r: 5, fill: "#D93D00", stroke: "#fff", "stroke-width": 2 });
  svg.append(cursor, dot);
  const mark = (index) => {
    const px = x(distance[index]);
    cursor.setAttribute("x1", px);
    cursor.setAttribute("x2", px);
    dot.setAttribute("cx", px);
    dot.setAttribute("cy", y(altitude[index]));
  };
  mark(0);
  return { svg, mark };
}

/** Initials in a round badge. */
export const avatar = (name, large = false) => h("span", { class: `avatar${large ? " avatar-lg" : ""}`, "aria-hidden": "true", text: initials(name) });
