// The team room: team, invite code, members, scenario states and captain controls, live within two seconds.
import { $, $$, OUTAGE, api, isOutage, listen, showState, signedIn, start, stateWord, utcText } from "./common.js";
import { announce, openDialog } from "./dialog.js";
import { wireTeamBand } from "./teamband.js";

start();
wireTeamBand();

const region = $("[data-room-region]");
const newCode = $("[data-new-code]");
const titles = new Map();
let me = null;
let room = null;
let wasMember = false;

function show(view) {
  $$("[data-room-view]").forEach((el) => { el.hidden = el.dataset.roomView !== view; });
}

function memberRow(member, captainView) {
  const li = document.createElement("li");
  li.className = "member";
  const info = document.createElement("div");
  info.className = "member-info";
  const name = document.createElement("span");
  name.className = "member-name";
  name.append(member.display_name);
  if (member.is_captain) {
    const marker = document.createElement("span");
    marker.className = "captain-marker";
    marker.textContent = "Captain";
    name.append(marker);
  }
  const meta = document.createElement("span");
  meta.className = "member-meta";
  meta.textContent = `Joined ${utcText(member.joined_at)} · ${member.tickets} ${member.tickets === 1 ? "ticket" : "tickets"}`;
  info.append(name, meta);
  li.append(info);
  if (captainView && member.user_id !== me.id) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-danger-outline btn-small";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${member.display_name}`);
    remove.addEventListener("click", () => confirmRemove(member, remove));
    li.append(remove);
  }
  return li;
}

function stateRow(state, number) {
  const li = document.createElement("li");
  const orb = document.createElement("span");
  orb.className = `orb${state.team_solved ? " is-lit" : ""}`;
  orb.setAttribute("aria-hidden", "true");
  orb.textContent = String(number).padStart(2, "0");
  const link = document.createElement("a");
  link.href = `/downtime/scenarios/${state.slug}`;
  link.textContent = titles.get(state.slug) ?? state.slug;
  const word = document.createElement("span");
  showState(word, stateWord(state));
  li.append(orb, link, word);
  return li;
}

function render(data) {
  room = data;
  const captainView = data.team.captain_id === me.id;
  $("[data-team-name]").textContent = data.team.name;
  $("[data-team-score]").textContent = String(data.score);
  $("[data-invite-code]").textContent = data.team.invite_code;
  newCode.hidden = !captainView;
  $("[data-members]").replaceChildren(...data.members.map((member) => memberRow(member, captainView)));
  $("[data-states]").replaceChildren(...data.scenarios.map((state, i) => stateRow(state, i + 1)));
  $("[data-cert-link]").hidden = !data.scenarios.every((state) => state.team_solved);
}

async function load() {
  if (!signedIn()) return show("signed-out");
  const result = await api("/api/teams/mine");
  if (result.status === 200) {
    wasMember = true;
    render(result.data);
    show("team");
  } else if (result.status === 404) {
    if (wasMember) announce(region, "You are no longer in this team", "error");
    wasMember = false;
    room = null;
    show("teamless");
  } else if (result.status === 401) {
    show("signed-out");
  } else {
    announce(region, OUTAGE, "outage");
  }
}

function failure(result, errors) {
  announce(region, isOutage(result) ? OUTAGE : errors[result.data?.error] ?? OUTAGE, "error");
}

function confirmRemove(member, opener) {
  const dialog = $("#remove-dialog");
  $("[data-remove-name]", dialog).textContent = member.display_name;
  const { close } = openDialog(dialog, opener);
  const confirm = $("[data-confirm-remove]", dialog);
  confirm.onclick = async () => {
    confirm.disabled = true;
    announce(region, "Removing…");
    const result = await api(`/api/teams/mine/members/${member.user_id}/remove`, { method: "POST" });
    confirm.disabled = false;
    close();
    if (result.status === 204) {
      announce(region, `${member.display_name} was removed`, "success");
      await load();
      newCode.focus();
    } else {
      failure(result, { not_captain: "Only the captain can do that", not_a_member: "That player is no longer in the team" });
      load();
    }
  };
}

newCode.addEventListener("click", async () => {
  newCode.disabled = true;
  announce(region, "Issuing new code…");
  const result = await api("/api/teams/mine/invite-code", { method: "POST" });
  newCode.disabled = false;
  if (result.status === 200) {
    $("[data-invite-code]").textContent = result.data.invite_code;
    announce(region, "New invite code issued", "success");
  } else {
    failure(result, { not_captain: "Only the captain can do that" });
  }
});

$("[data-copy-code]").addEventListener("click", async () => {
  await navigator.clipboard.writeText(room.team.invite_code).catch(() => {});
  announce(region, "Code copied", "success");
});

$("[data-copy-invite]").addEventListener("click", async () => {
  const link = `${window.location.origin}/downtime?join=${$("[data-invite-code]").textContent}#registration`;
  await navigator.clipboard.writeText(link).catch(() => {});
  announce(region, "Invite link copied", "success");
});

$("[data-leave]").addEventListener("click", (event) => {
  const dialog = $("#leave-dialog");
  const { close } = openDialog(dialog, event.currentTarget);
  const confirm = $("[data-confirm-leave]", dialog);
  confirm.onclick = async () => {
    confirm.disabled = true;
    announce(region, "Leaving team…");
    const name = room.team.name;
    const result = await api("/api/teams/leave", { method: "POST" });
    confirm.disabled = false;
    close();
    if (result.status === 204) {
      announce(region, `You left ${name}`, "success");
      window.location.assign("/downtime#registration");
    } else {
      failure(result, { not_in_team: "You are no longer in this team" });
      load();
    }
  };
});

async function begin() {
  if (!signedIn()) return show("signed-out");
  const [profile, scenarios] = await Promise.all([api("/api/me"), api("/api/scenarios")]);
  if (profile.status === 401) return show("signed-out");
  if (profile.status !== 200 || scenarios.status !== 200) return announce(region, OUTAGE, "outage");
  me = profile.data.user;
  scenarios.data.scenarios.forEach((s) => titles.set(s.slug, s.title));
  await load();
  let lost = false;
  listen((_, data) => {
    if (room && data.team_id === room.team.id) load();
  }, (state) => {
    if (state === "lost") {
      lost = true;
      if (room) announce(region, OUTAGE, "outage");
    } else if (lost) {
      lost = false;
      if (region.classList.contains("is-outage")) announce(region, "");
      load();
    }
  });
}
begin();
