/* Client-side router for the signed-in product: dashboard, upload, activity,
   segment, profile, recap and settings. Every figure is read from the server. */
"use strict";

const root = document.getElementById("appRoot");

document.getElementById("headerMount").innerHTML = appHeader(location.pathname);
injectSharedCss();
mountHeaderBehaviour();

async function requireSessionOrRedirect() {
  if (!Pacely.signedIn()) { window.location.href = "/login"; return false; }
  const me = await Pacely.api("GET", "/api/me");
  if (!me.ok) { Pacely.clearSession(); window.location.href = "/login"; return false; }
  Pacely.athlete = me.data.athlete;
  localStorage.setItem("pacely_athlete", JSON.stringify(Pacely.athlete));
  return true;
}

function notFoundInApp() {
  root.innerHTML = `<div class="card"><h1>This page isn't on the map</h1>
    <p><a class="btn btn-primary" href="/">Go to the Pacely home page</a></p></div>`;
}

async function navigate() {
  if (!(await requireSessionOrRedirect())) return;
  const path = window.location.pathname;
  document.getElementById("headerMount").innerHTML = appHeader(path);
  mountHeaderBehaviour();
  root.setAttribute("aria-busy", "true");
  try {
    if (path === "/dashboard") await renderDashboard();
    else if (path === "/upload") await renderUpload();
    else if (path.startsWith("/activities/")) await renderActivity(path.split("/")[2]);
    else if (path.startsWith("/segments/")) await renderSegment(path.split("/")[2]);
    else if (path.startsWith("/athletes/")) await renderProfile(path.split("/")[2]);
    else if (path === "/recap") await renderRecap();
    else if (path.startsWith("/settings/")) renderSettings();
    else notFoundInApp();
  } catch (err) {
    root.innerHTML = `<div class="card"><h1>Something went wrong</h1>
      <p class="small">That page could not be loaded. <a href="/dashboard">Back to the dashboard</a>.</p></div>`;
  } finally {
    root.setAttribute("aria-busy", "false");
  }
}

/* ------------------------------ dashboard ------------------------------ */
async function renderDashboard() {
  document.title = "Dashboard · Pacely";
  root.innerHTML = `
  <div class="grid" style="grid-template-columns:320px 1fr;align-items:start">
    <aside class="stack" id="athleteColumn"></aside>
    <section class="stack" id="feedColumn"></section>
  </div>`;

  const stats = await Pacely.api("GET", "/api/athletes/me/stats");
  const athlete = Pacely.athlete;
  const weeks = stats.ok ? stats.data.weeks : [];
  const lastWeeks = weeks.slice(-12);
  const maxDistance = Math.max(1, ...lastWeeks.map(w => w.distance_m));
  const week = weeks[weeks.length - 1] || { distance_m: 0, moving_time_s: 0 };
  document.getElementById("athleteColumn").innerHTML = `
    <div class="card">
      <span class="avatar" aria-hidden="true">${initials(athlete.name)}</span>
      <h2 style="font-size:20px;margin:8px 0">${athlete.name}</h2>
      <p class="small muted">Following ${await followingCount()} · Followers ${await followerCount()}</p>
      <div class="grid grid-2">
        <div class="stat"><span class="caps-label">This week</span><p class="value">${fmtKm(week.distance_m)}<span style="font-size:14px"> km</span></p></div>
        <div class="stat"><span class="caps-label">Moving time</span><p class="value">${fmtDuration(week.moving_time_s)}</p></div>
      </div>
      <p class="caps-label" style="margin:14px 0 4px">Last 12 weeks</p>
      <div class="chart" role="img" aria-label="Bar chart of distance over the last twelve weeks">
        ${lastWeeks.map(w => `<span class="bar" title="${w.week_start}: ${fmtKm(w.distance_m)} km"
            style="height:${Math.max(2, (w.distance_m / maxDistance) * 100)}%"></span>`).join("")}
      </div>
    </div>
    <a class="btn btn-primary" href="/upload">Upload activity</a>
    <a class="btn btn-quiet" href="/recap">Play your year recap</a>
  `;

  const feedCol = document.getElementById("feedColumn");
  feedCol.innerHTML = `<h1 style="font-size:26px">Your feed</h1><div id="feedList" class="stack"></div>
    <p id="feedEmpty" class="status-note" hidden>No activities yet. Upload your first GPX to start the feed.</p>
    <button class="btn btn-quiet" id="feedMore" hidden>Load more</button>`;

  let cursor = null;
  let done = false;
  const load = async () => {
    if (done) return;
    const res = await Pacely.api("GET", "/api/feed?limit=10" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    if (!res.ok) return;
    const list = document.getElementById("feedList");
    for (const activity of res.data.activities) {
      list.insertAdjacentHTML("beforeend", await feedCardHtml(activity));
    }
    mountKudosButtons(list);
    cursor = res.data.next_cursor;
    done = !cursor;
    document.getElementById("feedEmpty").hidden = list.children.length > 0;
    document.getElementById("feedMore").hidden = done;
  };
  document.getElementById("feedMore").addEventListener("click", load);
  const sentinel = document.getElementById("feedMore");
  new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) load();
  }, { rootMargin: "160px" }).observe(sentinel);
  await load();
}

async function followerCount() {
  const r = await Pacely.api("GET", `/api/athletes/${Pacely.athlete.id}`);
  return r.ok ? r.data.follower_count : 0;
}
async function followingCount() {
  const r = await Pacely.api("GET", `/api/athletes/${Pacely.athlete.id}`);
  return r.ok ? r.data.following_count : 0;
}

/* ------------------------------ upload ------------------------------ */
async function renderUpload() {
  document.title = "Upload activity · Pacely";
  root.innerHTML = `
  <div class="container narrow">
    <div class="card">
      <h1 style="font-size:26px">Upload a GPX activity</h1>
      <div class="field">
        <label for="gpxFile">GPX file</label>
        <div class="dropzone" id="dropzone"
             style="border:2px dashed var(--hairline);border-radius:var(--radius-m);padding:26px;text-align:center">
          <p class="muted">Drag a GPX file here</p>
        </div>
        <input id="gpxFile" type="file" accept=".gpx,application/gpx+xml,text/xml" style="margin-top:10px">
      </div>
      <div class="field">
        <label for="uploadName">Name</label>
        <input id="uploadName" type="text" maxlength="100" placeholder="Morning Run">
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label for="uploadSport">Sport</label>
          <select id="uploadSport">
            <option value="run">Run</option>
            <option value="ride">Ride</option>
            <option value="walk">Walk</option>
            <option value="hike">Hike</option>
          </select>
        </div>
        <div class="field">
          <label for="uploadVisibility">Visibility</label>
          <select id="uploadVisibility">
            <option value="everyone">Everyone</option>
            <option value="followers">Followers</option>
            <option value="only_me">Only You</option>
          </select>
        </div>
      </div>
      <div class="card tight" id="previewPanel" hidden>
        <span class="caps-label">Distance</span>
        <p class="value tnum" id="previewDistance" style="font-size:26px;font-weight:900;margin:0">—</p>
      </div>
      <p id="uploadStatus" class="status-note" role="status"></p>
      <p id="uploadError" class="field-error" role="alert"></p>
      <button class="btn btn-primary" id="saveActivity">Save activity</button>
    </div>
  </div>`;

  let gpxText = null;
  const fileInput = document.getElementById("gpxFile");
  const read = async (file) => {
    gpxText = await file.text();
    const preview = await previewDistance(gpxText);
    const panel = document.getElementById("previewPanel");
    panel.hidden = false;
    document.getElementById("previewDistance").textContent = preview + " km";
    document.getElementById("uploadStatus").textContent = `Parsed ${file.name}.`;
    document.getElementById("uploadError").textContent = "";
  };
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) read(fileInput.files[0]); });
  const dropzone = document.getElementById("dropzone");
  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.style.borderColor = "var(--orange)"; });
  dropzone.addEventListener("dragleave", () => { dropzone.style.borderColor = "var(--hairline)"; });
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--hairline)";
    const file = e.dataTransfer.files[0];
    if (file) read(file);
  });

  document.getElementById("saveActivity").addEventListener("click", async () => {
    const error = document.getElementById("uploadError");
    const status = document.getElementById("uploadStatus");
    error.textContent = "";
    if (!gpxText) { error.textContent = "Choose a GPX file first."; return; }
    const payload = {
      name: document.getElementById("uploadName").value.trim() || "Untitled activity",
      sport_type: document.getElementById("uploadSport").value,
      visibility: document.getElementById("uploadVisibility").value,
      gpx: gpxText,
    };
    const key = "upload-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    const res = await Pacely.api("POST", "/api/activities", payload, { "Idempotency-Key": key });
    if (res.status === 201 || res.ok) {
      status.textContent = "Saved. Opening your activity…";
      window.location.href = "/activities/" + res.data.activity.id;
      return;
    }
    const errors = {
      duplicate_activity: "You already uploaded an activity with this start time.",
      validation: "That GPX file could not be parsed. Check it has at least two track points with times.",
      payload_too_large: "That file is too large. Keep uploads under 5 MB.",
    };
    const fields = (res.data && res.data.fields) || {};
    const firstField = Object.entries(fields)[0];
    error.textContent = errors[res.data && res.data.error] ||
      (firstField ? `Check the ${firstField[0]} field.` : "The activity could not be saved. Please try again.");
  });
}

/* Client-side distance preview uses the same haversine rule as the server. */
async function previewDistance(gpxText) {
  try {
    const doc = new DOMParser().parseFromString(gpxText, "application/xml");
    const pts = Array.from(doc.getElementsByTagName("trkpt"));
    if (pts.length < 2) return "0.00";
    let total = 0;
    const prev = pts[0];
    let lat1 = Number(prev.getAttribute("lat")), lon1 = Number(prev.getAttribute("lon"));
    for (let i = 1; i < pts.length; i++) {
      const lat2 = Number(pts[i].getAttribute("lat")), lon2 = Number(pts[i].getAttribute("lon"));
      total += haversineJs(lat1, lon1, lat2, lon2);
      lat1 = lat2; lon1 = lon2;
    }
    return (total / 1000).toFixed(2);
  } catch (e) { return "0.00"; }
}
function haversineJs(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ------------------------------ activity ------------------------------ */
async function renderActivity(id) {
  const res = await Pacely.api("GET", `/api/activities/${id}`);
  if (!res.ok) { notFoundInApp(); return; }
  const a = res.data.activity;
  document.title = `${a.name} · Pacely`;
  const streams = await Pacely.api("GET", `/api/activities/${id}/streams`);
  const s = streams.ok ? streams.data : { latlng: [], altitude: [], distance: [], time: [] };
  const isOwner = Pacely.athlete.id === a.athlete_id;
  const pace = a.sport_type === "ride" ? fmtSpeed(a.avg_speed_kmh) : fmtPace(a.avg_pace_s_per_km);
  const paceLabel = a.sport_type === "ride" ? "Speed" : "Pace";
  const fastest = (a.splits || []).filter(sp => sp.distance_m === 1000)
                    .reduce((min, sp) => (!min || sp.elapsed_time_s < min.elapsed_time_s) ? sp : min, null);

  root.innerHTML = `
  <div class="stack" style="gap:20px">
    <div class="card">
      <div class="spread">
        <div>
          <p class="eyebrow">${a.sport_type} · ${a.visibility.replace("_", " ")}</p>
          <h1 style="font-size:28px">${a.name}</h1>
          <p class="small muted">${a.athlete_name} · ${fmtDateTime(a.start_time)}</p>
        </div>
        <div class="row">
          <a class="btn btn-quiet btn-sm" href="/athletes/${a.athlete_id}">${a.athlete_name}</a>
        </div>
      </div>
      <div class="stats-header">
        <div class="stat"><span class="caps-label">Distance</span><p class="value">${fmtKm(a.distance_m)} km</p></div>
        <div class="stat"><span class="caps-label">Moving Time</span><p class="value">${fmtDuration(a.moving_time_s)}</p></div>
        <div class="stat"><span class="caps-label">${paceLabel}</span><p class="value">${pace}</p></div>
        <div class="stat"><span class="caps-label">Elevation</span><p class="value">${fmtThousands(a.elevation_gain_m)} m</p></div>
        <div class="stat"><span class="caps-label">Elapsed Time</span><p class="value">${fmtDuration(a.elapsed_time_s)}</p></div>
      </div>
      ${isOwner ? `<div class="row">
        <button class="btn btn-quiet btn-sm" id="editButton">Edit</button>
        <button class="btn btn-danger btn-sm" id="deleteButton">Delete</button>
        <a class="btn btn-quiet btn-sm" href="/api/activities/${a.id}/export.gpx">Export GPX</a>
        <button class="btn btn-quiet btn-sm" id="createSegmentButton">Create segment</button>
      </div>` : ""}
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="spread">
          <span class="caps-label">Route</span>
          <div class="row" style="gap:8px">
            <label for="flyoverSpeed" class="visually-hidden">Flyover speed</label>
            <select id="flyoverSpeed" style="width:90px;min-height:40px">
              <option value="1">1x</option><option value="2">2x</option><option value="4">4x</option>
            </select>
            <button class="btn btn-primary btn-sm" id="flyoverButton" aria-pressed="false">Play flyover</button>
          </div>
        </div>
        ${routeMapSvg(s.latlng)}
        <p class="small muted" id="flyoverStatus" role="status"></p>
      </div>
      <div class="card">
        ${elevationPanel(s)}
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:20px">Splits</h2>
      <div class="table-frame" style="box-shadow:none">
        <table>
          <caption class="visually-hidden">Kilometre splits with pace and elevation</caption>
          <thead><tr><th scope="col">Km</th><th scope="col">Pace</th><th scope="col">Elev</th></tr></thead>
          <tbody>
            ${(a.splits || []).map(sp => `
              <tr>
                <td>${sp.split}${sp.distance_m === 1000 ? "" : " (" + fmtKm(sp.distance_m) + " km)"}
                  ${fastest && sp.split === fastest.split ? `<span class="split-fastest"> Fastest</span>` : ""}</td>
                <td class="tnum">${fmtPace(sp.pace_s_per_km)}</td>
                <td class="tnum">${fmtDuration(sp.elapsed_time_s)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <button class="btn btn-quiet btn-sm" id="audioSplitsButton" ${window.speechSynthesis ? "" : "disabled"}>
        Play audio splits</button>
      ${(a.splits || []).length === 0 ? '<p class="status-note">No splits yet for this activity.</p>' : ""}
    </div>

    ${(a.best_efforts || []).length ? `
    <div class="card">
      <h2 style="font-size:20px">Best efforts</h2>
      <ul>${a.best_efforts.map(b => `<li><strong>${b.name}</strong> — ${fmtDuration(b.elapsed_time_s)}</li>`).join("")}</ul>
    </div>` : ""}

    <div class="card">
      <h2 style="font-size:20px">Segment efforts</h2>
      ${(a.segment_efforts || []).length ? `
      <ul class="stack" style="list-style:none;padding:0">
        ${a.segment_efforts.map(e => `
        <li class="spread">
          <a href="/segments/${e.segment_id}">${e.segment_name}</a>
          <span class="row">
            <span class="tnum">${fmtDuration(e.elapsed_time_s)}</span>
            ${e.is_crown ? crownMarkup() : ""}
            ${medalMarkup(e.pr_rank)}
          </span>
        </li>`).join("")}
      </ul>` : `<p class="status-note">No segments matched this activity yet.</p>`}
    </div>

    <div class="card">
      <div class="spread">
        <h2 style="font-size:20px;margin:0">Kudos</h2>
        <button class="btn btn-quiet kudos-btn" id="activityKudos" data-activity="${a.id}" data-given="false"
                aria-pressed="false" aria-label="Give kudos, ${a.kudos_count}">${THUMB_SVG}<span class="count">${a.kudos_count}</span></button>
      </div>
      <p class="small muted" id="kudosNames"></p>
    </div>

    <div class="card">
      <h2 style="font-size:20px">Comments</h2>
      <form id="commentForm" class="field">
        <label for="commentText">Add a comment</label>
        <textarea id="commentText" maxlength="500"></textarea>
        <button class="btn btn-primary btn-sm" type="submit">Post</button>
        <p id="commentError" class="field-error" role="alert"></p>
      </form>
      <ul id="commentList" class="stack" style="list-style:none;padding:0"></ul>
    </div>
  </div>`;

  mountElevationProfile(s);
  mountFlyover(s, { markerId: "flyMarker" });
  mountAudioSplits(a.splits || []);

  const kudosRes = await Pacely.api("GET", `/api/activities/${id}/kudos`);
  if (kudosRes.ok) {
    document.getElementById("kudosNames").textContent =
      kudosRes.data.athletes.map(x => x.name).join(", ") || "No kudos yet.";
  }
  const mine = kudosRes.ok && kudosRes.data.athletes.some(x => x.id === Pacely.athlete.id);
  if (mine) {
    const btn = document.getElementById("activityKudos");
    btn.setAttribute("data-given", "true");
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", "Remove kudos, " + a.kudos_count);
    btn.classList.add("given");
  }
  mountKudosButtons(root);

  const commentsRes = await Pacely.api("GET", `/api/activities/${id}/comments`);
  const list = document.getElementById("commentList");
  const renderComments = (comments) => {
    list.innerHTML = comments.map(c => `
      <li class="card tight">
        <div class="spread">
          <span><strong>${c.athlete_name}</strong> <span class="small muted">${fmtDateTime(c.created_at)}</span></div>
          <div class="row">
            ${c.athlete_id === Pacely.athlete.id || isOwner
              ? `<button class="btn btn-ghost btn-sm" data-del-comment="${c.id}">Delete</button>` : ""}
          </div>
        </div>
        <p style="margin:6px 0 0">${c.text}</p>
      </li>`).join("") || `<li class="status-note">No comments yet. Be the first to cheer.</li>`;
    list.querySelectorAll("[data-del-comment]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await Pacely.api("DELETE", `/api/comments/${btn.dataset.delComment}`);
        const fresh = await Pacely.api("GET", `/api/activities/${id}/comments`);
        if (fresh.ok) renderComments(fresh.data.comments);
      });
    });
  };
  if (commentsRes.ok) renderComments(commentsRes.data.comments);

  const activityKudosBtn = document.getElementById("activityKudos");
  if (activityKudosBtn) {
    activityKudosBtn.addEventListener("pacely:kudos", async () => {
      const fresh = await Pacely.api("GET", `/api/activities/${id}/kudos`);
      if (fresh.ok) {
        document.getElementById("kudosNames").textContent =
          fresh.data.athletes.map(x => x.name).join(", ") || "No kudos yet.";
      }
    });
  }

  document.getElementById("commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = document.getElementById("commentText").value;
    const error = document.getElementById("commentError");
    error.textContent = "";
    const res = await Pacely.api("POST", `/api/activities/${id}/comments`, { text });
    if (res.ok) {
      document.getElementById("commentText").value = "";
      const fresh = await Pacely.api("GET", `/api/activities/${id}/comments`);
      if (fresh.ok) renderComments(fresh.data.comments);
      announce("Comment posted.", "status");
    } else {
      error.textContent = "Comment could not be posted";
    }
  });

  if (isOwner) {
    document.getElementById("deleteButton").addEventListener("click", async () => {
      if (!confirm("Delete this activity? Its efforts, kudos and comments will be removed.")) return;
      const res = await Pacely.api("DELETE", `/api/activities/${id}`);
      if (res.ok) window.location.href = "/dashboard";
      else announce("The activity could not be deleted.", "alert");
    });
    document.getElementById("editButton").addEventListener("click", () => {
      const name = prompt("New activity name:", a.name);
      if (name === null) return;
      const visibility = prompt("Visibility (everyone, followers, only_me):", a.visibility);
      if (visibility === null) return;
      Pacely.api("PATCH", `/api/activities/${id}`, { name, visibility }).then(r => {
        if (r.ok) navigate();
        else announce("The activity could not be edited.", "alert");
      });
    });
    document.getElementById("createSegmentButton").addEventListener("click", () => {
      const slider = document.getElementById("routePosition");
      const form = document.createElement("div");
      form.className = "card tight";
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-label", "Create a segment");
      form.innerHTML = `
        <h3>Create a segment</h3>
        <p class="small muted">Move the Route position slider to choose a start, then set the end index below.</p>
        <div class="field">
          <label for="segmentStart">Start index</label>
          <input id="segmentStart" type="number" min="0" max="${slider ? Number(slider.max) : 1}" value="0">
        </div>
        <div class="field">
          <label for="segmentEnd">End index</label>
          <input id="segmentEnd" type="number" min="1" max="${slider ? Number(slider.max) : 1}" value="${slider ? Number(slider.max) : 1}">
        </div>
        <div class="field">
          <label for="segmentName">Segment name</label>
          <input id="segmentName" type="text" maxlength="60" placeholder="Aurora Avenue Sprint">
        </div>
        <p class="field-error" role="alert" id="segmentError"></p>
        <div class="row">
          <button class="btn btn-primary btn-sm" id="segmentSave">Create segment</button>
          <button class="btn btn-quiet btn-sm" id="segmentCancel">Cancel</button>
        </div>`;
      form.querySelector("#segmentCancel").addEventListener("click", () => form.remove());
      form.querySelector("#segmentSave").addEventListener("click", async () => {
        const payload = {
          activity_id: id,
          start_index: Number(form.querySelector("#segmentStart").value),
          end_index: Number(form.querySelector("#segmentEnd").value),
          name: form.querySelector("#segmentName").value.trim(),
        };
        const r = await Pacely.api("POST", "/api/segments", payload);
        if (r.ok) window.location.href = "/segments/" + r.data.id;
        else form.querySelector("#segmentError").textContent =
          "The segment could not be created. Check the name is 3–60 characters and the indexes fit this activity.";
      });
      document.getElementById("createSegmentButton").closest(".card").appendChild(form);
      form.querySelector("#segmentName").focus();
    });
  }
}

window.addEventListener("popstate", navigate);
navigate();
