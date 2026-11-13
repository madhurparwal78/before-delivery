import { api } from "../api.js";
import { duration, element } from "../format.js";
import { award } from "../medals.js";

let segmentId = null;

function showSegment(segment) {
  document.querySelector("[data-segment-name]").textContent = segment.name;
  document.title = `${segment.name} — Pacely`;
  document.querySelector("[data-segment-distance]").textContent = `${(segment.distance_m / 1000).toFixed(2)} km`;
  document.querySelector("[data-segment-elevation]").textContent = `${segment.elevation_diff_m} m`;
  document.querySelector("[data-segment-grade]").textContent =
    `${((segment.elevation_diff_m / segment.distance_m) * 100).toFixed(1)}%`;
  document.querySelector("[data-segment-line]").setAttribute("d", "M40 92 L360 28");
}

function row(entry, crown) {
  const rank = element("th", { scope: "row", class: "tnum", text: String(entry.rank) });
  if (crown) rank.append(award("crown", "First place", "crown"));
  return element("tr", {}, [
    rank,
    element("td", {}, [element("a", { href: `/athletes/${entry.athlete_id}`, text: entry.athlete_name })]),
    element("td", { class: "tnum", text: duration(entry.elapsed_time_s) }),
    element("td", { class: "tnum", text: entry.start_time.slice(0, 10) }),
  ]);
}

async function loadBoard(filter) {
  const query = filter === "following" ? "?filter=following" : "";
  const { ok, data } = await api(`/api/segments/${segmentId}/leaderboard${query}`);
  const body = document.querySelector("[data-leaderboard-body]");
  const empty = document.querySelector("[data-leaderboard-empty]");
  const viewerBox = document.querySelector("[data-viewer-entry]");
  const viewerBody = document.querySelector("[data-viewer-body]");
  if (!ok) {
    document.querySelector("[data-segment-error]").textContent = "This leaderboard is not available.";
    document.querySelector("[data-segment-error]").hidden = false;
    return;
  }
  body.textContent = "";
  data.entries.forEach((entry) => body.append(row(entry, entry.rank === 1)));
  empty.hidden = data.entries.length > 0;
  const shown = data.entries.some((entry) => entry.rank === data.viewer_entry?.rank);
  if (data.viewer_entry && !shown) {
    viewerBody.textContent = "";
    viewerBody.append(row(data.viewer_entry, false));
    viewerBox.hidden = false;
  } else {
    viewerBox.hidden = true;
  }
}

function tabs() {
  const controls = [...document.querySelectorAll("[data-board]")];
  const select = (filter, push) => {
    controls.forEach((tab) => {
      const chosen = tab.dataset.board === filter;
      tab.setAttribute("aria-selected", String(chosen));
      tab.tabIndex = chosen ? 0 : -1;
    });
    if (push) {
      const url = filter === "following"
        ? `/segments/${segmentId}?filter=following`
        : `/segments/${segmentId}`;
      window.history.pushState({ filter }, "", url);
    }
    loadBoard(filter);
  };
  controls.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab.dataset.board, true));
    tab.addEventListener("keydown", (event) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      if (event.key in moves) {
        event.preventDefault();
        const next = controls[(index + moves[event.key] + controls.length) % controls.length];
        next.focus();
        select(next.dataset.board, true);
      }
    });
  });
  window.addEventListener("popstate", () => {
    select(new URLSearchParams(window.location.search).get("filter") || "overall", false);
  });
  return select;
}

export async function init() {
  segmentId = document.querySelector("[data-segment-page]").dataset.segmentId;
  const { ok, data } = await api(`/api/segments/${segmentId}`);
  if (!ok) {
    document.querySelector("[data-segment-error]").textContent = "This segment is not available.";
    document.querySelector("[data-segment-error]").hidden = false;
    return;
  }
  showSegment(data);
  const select = tabs();
  select(new URLSearchParams(window.location.search).get("filter") || "overall", false);
}
