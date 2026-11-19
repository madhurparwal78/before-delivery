/* Game detail: weekly history and community link (DP-45, DP-37). */
"use strict";
(() => {
  const body = document.getElementById("historyBody");
  const line = document.getElementById("gameCommunityLine");
  if (!body) return;
  const slug = location.pathname.split("/").pop();
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  fetch(`/api/games/${slug}`, {
    headers: HUB.state.token ? { Authorization: "Bearer " + HUB.state.token } : {},
  }).then((resp) => {
    if (!resp.ok) throw new Error("not found");
    return resp.json();
  }).then((game) => {
    body.textContent = "";
    for (const row of game.history || []) {
      const tr = document.createElement("tr");
      const weekCell = document.createElement("td");
      const [y, m, d] = row.week_date.split("-").map(Number);
      weekCell.textContent = `Week of ${MONTHS[m - 1]} ${d}, ${y}`;
      const rankCell = document.createElement("td");
      rankCell.textContent = `#${row.rank}`;
      const playsCell = document.createElement("td");
      playsCell.textContent = `${row.plays_change_pct > 0 ? "+" : ""}${row.plays_change_pct}%`;
      const streamsCell = document.createElement("td");
      streamsCell.textContent = `${row.streams_change_pct > 0 ? "+" : ""}${row.streams_change_pct}%`;
      tr.append(weekCell, rankCell, playsCell, streamsCell);
      body.appendChild(tr);
    }
    if (game.community) {
      const link = document.createElement("a");
      link.href = `/servers/${game.community.slug}`;
      link.textContent = `Join ${game.community.name}`;
      link.className = "btn btn-indigo";
      line.textContent = "";
      line.appendChild(link);
    } else {
      line.textContent = "Community not available.";
    }
  }).catch(() => {
    body.textContent = "";
    line.textContent = "Community not available.";
  });
})();
