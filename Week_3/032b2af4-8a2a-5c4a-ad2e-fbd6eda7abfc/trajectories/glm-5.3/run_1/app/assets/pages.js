/* Segment page, athlete profile, recap player and settings: the rest of the product. */
"use strict";

/* ------------------------------ segment ------------------------------ */
async function renderSegment(id) {
  const segRes = await Pacely.api("GET", `/api/segments/${id}`);
  if (!segRes.ok) { notFoundInApp(); return; }
  const seg = segRes.data;
  document.title = `${seg.name} · Pacely`;
  const params = new URLSearchParams(window.location.search);
  const filter = params.get("filter") === "following" ? "following" : "overall";
  const boardRes = await Pacely.api("GET", `/api/segments/${id}/leaderboard?filter=${filter}`);
  if (!boardRes.ok) { notFoundInApp(); return; }
  const board = boardRes.data;

  const grade = (seg.elevation_diff_m / seg.distance_m * 100).toFixed(1);
  const entries = board.entries || [];
  const viewer = board.viewer_entry;
  const shownIds = new Set(entries.map(e => e.athlete_id));
  const viewerOutside = viewer && !shownIds.has(viewer.athlete_id);

  document.getElementById("appRoot").innerHTML = `
  <div class="stack" style="gap:18px">
    <div class="card">
      <p class="eyebrow">Segment</p>
      <h1 style="font-size:28px">${seg.name}</h1>
      <div class="stats-header">
        <div class="stat"><span class="caps-label">Distance</span><p class="value">${fmtKm(seg.distance_m)} km</p></div>
        <div class="stat"><span class="caps-label">Elevation difference</span><p class="value">${seg.elevation_diff_m} m</p></div>
        <div class="stat"><span class="caps-label">Average grade</span><p class="value">${grade}%</p></div>
        <div class="stat"><span class="caps-label">Efforts</span><p class="value">${seg.effort_count}</p></div>
        <div class="stat"><span class="caps-label">Athletes</span><p class="value">${seg.athlete_count}</p></div>
      </div>
      <div style="max-width:420px">${routeMapSvg([[seg.start_lat, seg.start_lon], [seg.end_lat, seg.end_lon]], { height: 180, width: 420 })}</div>
    </div>

    <div class="card">
      <div class="tablist" role="tablist" aria-label="Leaderboard filters">
        <button role="tab" id="tabOverall" aria-selected="${filter === "overall"}" aria-controls="boardPanel">Overall</button>
        <button role="tab" id="tabFollowing" aria-selected="${filter === "following"}" aria-controls="boardPanel"
                tabindex="${filter === "following" ? "0" : "-1"}">Following</button>
      </div>
      <div role="tabpanel" id="boardPanel" aria-labelledby="${filter === "following" ? "tabFollowing" : "tabOverall"}">
        <h2 style="font-size:20px">Leaderboard · ${board.entry_count} ${board.entry_count === 1 ? "entry" : "entries"}</h2>
        <div class="table-frame" style="box-shadow:none">
          <table>
            <caption class="visually-hidden">Segment leaderboard ranked by time</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Athlete</th><th scope="col">Time</th><th scope="col">Date</th></tr></thead>
            <tbody>
              ${entries.map(e => `
              <tr class="${viewer && e.athlete_id === viewer.athlete_id ? "viewer-row" : ""}">
                <td>${e.rank === 1 ? crownMarkup() + " 1" : e.rank}</td>
                <td><a href="/athletes/${e.athlete_id}">${e.athlete_name}</a></td>
                <td class="tnum">${fmtDuration(e.elapsed_time_s)}</td>
                <td>${fmtDate(e.start_time)}</td>
              </tr>`).join("") || `<tr><td colspan="4">No efforts on this leaderboard yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${viewerOutside ? `
        <div class="card tight viewer-row" style="margin-top:12px">
          <strong>Your entry</strong> — Rank ${viewer.rank}, ${fmtDuration(viewer.elapsed_time_s)}, ${fmtDate(viewer.start_time)}
        </div>` : ""}
        ${!Pacely.athlete.subscriber && board.entry_count > entries.length
          ? `<p class="small muted">Subscribe to see every entry on this leaderboard.</p>` : ""}
      </div>
    </div>
  </div>`;

  const setFilter = (f) => {
    const url = new URL(window.location);
    if (f === "following") url.searchParams.set("filter", "following"); else url.searchParams.delete("filter");
    history.pushState(null, "", url);
    renderSegment(id);
  };
  document.getElementById("tabOverall").addEventListener("click", () => setFilter("overall"));
  document.getElementById("tabFollowing").addEventListener("click", () => setFilter("following"));
  const tabs = [document.getElementById("tabOverall"), document.getElementById("tabFollowing")];
  tabs.forEach((tab, i) => tab.addEventListener("keydown", e => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = tabs[(i + 1) % 2];
      next.focus();
      setFilter(next.id === "tabFollowing" ? "following" : "overall");
    }
  }));
}

/* ------------------------------ profile ------------------------------ */
async function renderProfile(id) {
  const res = await Pacely.api("GET", `/api/athletes/${id}`);
  if (!res.ok) { notFoundInApp(); return; }
  const p = res.data;
  document.title = `${p.name} · Pacely`;
  const isSelf = p.id === Pacely.athlete.id;

  const actsRes = await Pacely.api("GET", `/api/athletes/${id}/activities?limit=10`);
  const acts = actsRes.ok ? actsRes.data.activities : [];
  const trophiesRes = await Pacely.api("GET", `/api/athletes/${id}/trophies`);
  const trophies = trophiesRes.ok ? trophiesRes.data.trophies : [];
  const statsRes = await Pacely.api("GET", `/api/athletes/me/stats`);
  const weeks = statsRes.ok ? statsRes.data.weeks.slice(-12) : [];
  const maxDistance = Math.max(1, ...weeks.map(w => w.distance_m));

  const followLabel = { none: "Follow", pending: "Requested", accepted: "Following", self: "" }[p.follow_status] || "Follow";

  document.getElementById("appRoot").innerHTML = `
  <div class="stack" style="gap:18px">
    <div class="card">
      <div class="spread">
        <div class="row">
          <span class="avatar" aria-hidden="true">${initials(p.name)}</span>
          <div>
            <h1 style="font-size:26px">${p.name}</h1>
            <p class="small muted">${p.private ? "Private account" : "Public account"} ·
              ${p.follower_count} Followers · Following ${p.following_count}</p>
          </div>
        </div>
        ${isSelf ? "" : `<button class="btn btn-primary" id="followButton">${followLabel}</button>`}
      </div>
    </div>

    <div class="card">
      <span class="caps-label">Last 12 weeks ${isSelf ? "" : "of your training"}</span>
      <div class="chart" role="img" aria-label="Bar chart of weekly distance">
        ${weeks.map(w => `<span class="bar" title="${w.week_start}: ${fmtKm(w.distance_m)} km"
            style="height:${Math.max(2, (w.distance_m / maxDistance) * 100)}%"></span>`).join("")}
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:20px">Trophy case</h2>
      ${trophies.length ? `<div class="trophy-grid">
        ${trophies.map(t => `<div class="trophy"><span class="avatar" aria-hidden="true">🏆</span>
          <div><strong>${t.name}</strong><div class="small muted">Completed ${fmtDate(t.completed_at)}</div></div></div>`).join("")}
      </div>` : `<p class="status-note">No completed challenges yet. Join one on the challenges page.</p>`}
    </div>

    <div class="card">
      <h2 style="font-size:20px">Activities</h2>
      <div class="stack" id="profileActivities">
        ${acts.length ? acts.map(a => `
        <div class="spread card tight">
          <div><a href="/activities/${a.id}">${a.name}</a>
            <div class="small muted">${fmtDateTime(a.start_time)} · ${a.sport_type}</div></div>
          <div class="row"><span class="tnum">${fmtKm(a.distance_m)} km</span>
            <span class="tnum">${a.sport_type === "ride" ? fmtSpeed(a.avg_speed_kmh) : fmtPace(a.avg_pace_s_per_km)}</span></div>
        </div>`).join("") : `<p class="status-note">No visible activities yet.</p>`}
      </div>
    </div>
  </div>`;

  const followButton = document.getElementById("followButton");
  if (followButton) {
    followButton.addEventListener("click", async () => {
      if (p.follow_status === "accepted") {
        await Pacely.api("DELETE", `/api/athletes/${id}/follow`);
        p.follow_status = "none";
        followButton.textContent = "Follow";
      } else {
        const r = await Pacely.api("POST", `/api/athletes/${id}/follow`);
        if (r.ok) { p.follow_status = r.data.status; followButton.textContent = r.data.status === "pending" ? "Requested" : "Following"; }
      }
    });
  }
}

/* ------------------------------ recap ------------------------------ */
async function renderRecap() {
  document.title = "Your year on Pacely";
  const year = new Date().getFullYear();
  const res = await Pacely.api("GET", `/api/athletes/me/recap?year=${year}`);
  const recap = res.ok ? res.data : {
    year, activity_count: 0, distance_m: 0, moving_time_s: 0, elevation_gain_m: 0,
    longest_activity_id: null, top_sport: null, kudos_received: 0,
  };
  let longestName = "—";
  let longestDistance = 0;
  if (recap.longest_activity_id) {
    const longest = await Pacely.api("GET", `/api/activities/${recap.longest_activity_id}`);
    if (longest.ok) { longestName = longest.data.activity.name; longestDistance = longest.data.activity.distance_m; }
  }
  const cards = [
    { title: "Total distance", big: `${(recap.distance_m / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
      note: "Every metre you covered, counted from your own GPS points." },
    { title: "Activities", big: String(recap.activity_count),
      note: "Each one recorded, parsed and shared with the people who follow you." },
    { title: "Elevation gained", big: `${fmtThousands(recap.elevation_gain_m)} m`,
      note: "Climbing summed from every rise in your track." },
    { title: "Longest activity", big: longestName, note: `${fmtKm(longestDistance)} km in a single effort.` },
    { title: "Top sport", big: (recap.top_sport || "—"), note: `You collected ${recap.kudos_received} kudos this year.` },
  ];
  document.getElementById("appRoot").innerHTML = `
  <section class="recap-hero" style="border-radius:var(--radius-l);padding:30px 20px">
    <div class="recap-progress" id="recapProgress" aria-hidden="true">
      ${cards.map((c, i) => `<span class="seg"><span class="bar" id="seg${i}"></span></span>`).join("")}
    </div>
    <p class="visually-hidden" role="status" id="recapStatus">Slide 1 of 5</p>
    <div class="recap-stage" id="recapStage">
      ${cards.map((c, i) => `
      <div class="recap-card ${i === 0 ? "current" : ""}" id="recapCard${i}">
        <p class="eyebrow" style="color:#ffb28c">${c.title}</p>
        <p class="recap-big">${c.big}</p>
        <p style="color:#f4ddd2;max-width:480px">${c.note}</p>
      </div>`).join("")}
    </div>
    <div class="row" style="justify-content:center">
      <button class="btn btn-primary" id="recapPlay">Play recap</button>
      <button class="btn btn-quiet" id="recapMute">Mute</button>
      <button class="btn btn-quiet" id="recapPrev">Previous</button>
      <button class="btn btn-quiet" id="recapNext">Next</button>
    </div>
    <p class="center" style="color:#f4ddd2">${recap.activity_count === 0 ? "A quiet year so far — upload an activity to start filling it." : ""}</p>
  </section>`;

  let index = 0;
  let playing = false;
  let timer = null;
  const audio = new Audio("/assets/recap-track.mp3");
  audio.loop = true;
  const show = (i) => {
    index = (i + cards.length) % cards.length;
    document.querySelectorAll(".recap-card").forEach((el, k) => el.classList.toggle("current", k === index));
    document.getElementById("recapStatus").textContent = `Slide ${index + 1} of 5`;
    cards.forEach((_, k) => {
      const bar = document.getElementById("seg" + k);
      if (bar) bar.style.width = k < index ? "100%" : (k === index ? "0%" : "0%");
    });
  };
  const fillCurrent = () => {
    const bar = document.getElementById("seg" + index);
    if (bar && !reducedMotion()) bar.style.transition = "width 5s linear";
    if (bar) bar.style.width = "100%";
  };
  const stop = () => {
    playing = false;
    clearTimeout(timer);
    audio.pause();
    document.getElementById("recapPlay").textContent = "Play recap";
  };
  document.getElementById("recapPlay").addEventListener("click", () => {
    if (playing) { stop(); return; }
    playing = true;
    document.getElementById("recapPlay").textContent = "Pause recap";
    audio.play().catch(() => {});
    fillCurrent();
    timer = setInterval(() => { show(index + 1); fillCurrent(); }, 5000);
  });
  document.getElementById("recapNext").addEventListener("click", () => { show(index + 1); });
  document.getElementById("recapPrev").addEventListener("click", () => { show(index - 1); });
  document.getElementById("recapMute").addEventListener("click", (e) => {
    audio.muted = !audio.muted;
    e.currentTarget.textContent = audio.muted ? "Unmute" : "Mute";
  });
  audio.addEventListener("ended", () => {});
  window.addEventListener("beforeunload", () => { audio.pause(); clearTimeout(timer); });
  show(0);
}

/* ------------------------------ settings ------------------------------ */
function renderSettings() {
  document.title = "Privacy settings · Pacely";
  const athlete = Pacely.athlete;
  document.getElementById("appRoot").innerHTML = `
  <div class="container narrow stack" style="gap:18px">
    <div class="card">
      <h1 style="font-size:26px">Privacy settings</h1>
      <form id="privacyForm" class="stack" style="gap:16px">
        <div class="switch-row">
          <label for="privateAccount">Private account</label>
          <button class="switch" id="privateAccount" role="switch" aria-checked="false" type="button"></button>
        </div>
        <div class="field">
          <label for="defaultVisibility">Default visibility</label>
          <select id="defaultVisibility">
            <option value="everyone">Everyone</option>
            <option value="followers">Followers</option>
            <option value="only_me">Only You</option>
          </select>
        </div>
        <fieldset class="card tight" style="border-radius:var(--radius-m)">
          <legend class="caps-label">Privacy zone</legend>
          <p class="small muted">Points inside the radius are hidden from every other athlete. Your figures never change.</p>
          <div class="grid grid-2">
            <div class="field"><label for="zoneLat">Latitude</label><input id="zoneLat" type="text" inputmode="decimal" placeholder="47.6000"></div>
            <div class="field"><label for="zoneLon">Longitude</label><input id="zoneLon" type="text" inputmode="decimal" placeholder="-122.3300"></div>
          </div>
          <div class="field">
            <label for="zoneRadius">Radius</label>
            <select id="zoneRadius">
              <option value="200">200 m</option>
              <option value="400">400 m</option>
              <option value="800">800 m</option>
              <option value="1600">1600 m</option>
            </select>
          </div>
          <button class="btn btn-quiet btn-sm" id="removeZone" type="button">Remove privacy zone</button>
        </fieldset>
        <div class="field">
          <label for="timeZone">Time zone</label>
          <select id="timeZone">
            <option value="UTC">UTC</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
            <option value="America/New_York">America/New_York</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Europe/Berlin">Europe/Berlin</option>
            <option value="Asia/Kolkata">Asia/Kolkata</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="Australia/Sydney">Australia/Sydney</option>
          </select>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="submit">Save</button>
          <button class="btn btn-quiet" type="button" id="reloadPrivacy">Reload saved settings</button>
        </div>
        <p id="privacyStatus" class="success-note" role="status"></p>
        <p id="privacyError" class="field-error" role="alert"></p>
      </form>
    </div>

    <div class="card">
      <h2 style="font-size:20px">Delete account</h2>
      <p class="small">This erases your activities, kudos, comments and follows immediately. Your email can sign up again as a new athlete.</p>
      <button class="btn btn-danger" id="openDeleteDialog">Delete account</button>
      <div class="card tight" id="deleteDialog" role="dialog" aria-modal="true" aria-labelledby="deleteTitle" hidden>
        <h3 id="deleteTitle">Confirm deletion</h3>
        <div class="field"><label for="deletePassword">Password</label>
          <input id="deletePassword" type="password" autocomplete="current-password"></div>
        <div class="row">
          <button class="btn btn-danger btn-sm" id="confirmDelete">Delete my account</button>
          <button class="btn btn-quiet btn-sm" id="cancelDelete">Cancel</button>
        </div>
        <p id="deleteError" class="field-error" role="alert"></p>
      </div>
    </div>
  </div>`;

  let zoneRemoved = false;
  const load = async () => {
    const me = await Pacely.api("GET", "/api/me");
    const privacy = await Pacely.api("GET", "/api/me/privacy");
    if (!me.ok || !privacy.ok) return;
    document.getElementById("privateAccount").setAttribute("aria-checked", String(privacy.data.private));
    document.getElementById("defaultVisibility").value = privacy.data.default_visibility;
    document.getElementById("timeZone").value = me.data.athlete.time_zone;
    if (privacy.data.privacy_zone) {
      document.getElementById("zoneLat").value = privacy.data.privacy_zone.lat;
      document.getElementById("zoneLon").value = privacy.data.privacy_zone.lon;
      document.getElementById("zoneRadius").value = String(privacy.data.privacy_zone.radius_m);
      zoneRemoved = false;
    }
  };
  load();
  document.getElementById("reloadPrivacy").addEventListener("click", () => { load(); zoneRemoved = false; });
  document.getElementById("privateAccount").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    btn.setAttribute("aria-checked", String(btn.getAttribute("aria-checked") !== "true"));
  });
  document.getElementById("removeZone").addEventListener("click", () => {
    document.getElementById("zoneLat").value = "";
    document.getElementById("zoneLon").value = "";
    zoneRemoved = true;
    announce("Privacy zone will be removed when you save.", "status");
  });

  document.getElementById("privacyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("privacyStatus");
    const error = document.getElementById("privacyError");
    status.textContent = ""; error.textContent = "";
    const lat = document.getElementById("zoneLat").value.trim();
    const lon = document.getElementById("zoneLon").value.trim();
    let zone = null;
    if (lat && lon) {
      zone = { lat: Number(lat), lon: Number(lon), radius_m: Number(document.getElementById("zoneRadius").value) };
    }
    const privacy = await Pacely.api("PUT", "/api/me/privacy", {
      private: document.getElementById("privateAccount").getAttribute("aria-checked") === "true",
      default_visibility: document.getElementById("defaultVisibility").value,
      privacy_zone: zone,
    });
    if (!privacy.ok) {
      error.textContent = "Those privacy settings could not be saved. Check the zone values.";
      return;
    }
    await Pacely.api("PATCH", "/api/me", { time_zone: document.getElementById("timeZone").value });
    status.textContent = "Privacy settings saved";
  });

  document.getElementById("openDeleteDialog").addEventListener("click", () => {
    document.getElementById("deleteDialog").hidden = false;
    document.getElementById("deletePassword").focus();
  });
  document.getElementById("cancelDelete").addEventListener("click", () => {
    document.getElementById("deleteDialog").hidden = true;
  });
  document.getElementById("confirmDelete").addEventListener("click", async () => {
    const password = document.getElementById("deletePassword").value;
    const res = await Pacely.api("DELETE", "/api/me", { password });
    if (res.ok) { Pacely.clearSession(); window.location.href = "/"; }
    else document.getElementById("deleteError").textContent = "That password did not match. Nothing was deleted.";
  });
}
