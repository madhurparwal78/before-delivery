/* The team room: members, invite code, scenario states and captain controls. */

import {
  OUTAGE_COPY,
  announce,
  api,
  closeDialog,
  connectStream,
  dialog,
  escapeText,
  openDialog,
  session,
  startChrome,
  stateWord,
  utcTime,
} from "./core.js";
import { setUpTeamActions } from "./teams.js";

const SCENARIO_COUNT = 8;
const REMOVE_ERRORS = {
  not_captain: "Only the captain can do that",
  not_a_member: "That player is no longer in the team",
};

const body = document.querySelector("[data-room-body]");
const empty = document.querySelector("[data-room-empty]");
const teamName = document.querySelector("[data-room-team-name]");
const code = document.querySelector("[data-room-code]");
const score = document.querySelector("[data-room-score]");
const members = document.querySelector("[data-room-members]");
const scenarioList = document.querySelector("[data-room-scenarios]");
const newCode = document.querySelector("[data-new-code]");
const certificateLink = document.querySelector("[data-certificate-link]");

let titles = new Map();
let room = null;
let hadTeam = false;
let removing = null;

function roomState(state) {
  if (state.solved_by_me) return stateWord("Solved by me", true);
  if (state.team_solved) return stateWord("Solved by the team", true);
  if (state.attempted_by_me) return stateWord("Attempted", false);
  return stateWord("Not attempted", false);
}

function drawRoom(data) {
  room = data;
  hadTeam = true;
  body.hidden = false;
  empty.hidden = true;
  teamName.textContent = data.team.name;
  code.textContent = data.team.invite_code;
  score.textContent = String(data.score);
  const mine = session();
  const amCaptain = Boolean(mine && data.team.captain_id === mine.user.id);
  newCode.hidden = !amCaptain;

  members.innerHTML = data.members
    .map((member) => {
      const captain = member.is_captain
        ? '<span class="captain-marker">Captain</span>'
        : "";
      const remove =
        amCaptain && !member.is_captain
          ? `<button type="button" class="button button-outline" data-remove="${
              member.user_id
            }" data-name="${escapeText(
              member.display_name,
            )}">Remove ${escapeText(member.display_name)}</button>`
          : "";
      return `<li>
<span class="member-name">${escapeText(member.display_name)}</span>
${captain}
<span class="member-meta">Joined ${escapeText(utcTime(member.joined_at))}</span>
<span class="member-meta">${member.tickets} raffle ${
        member.tickets === 1 ? "ticket" : "tickets"
      }</span>
${remove}
</li>`;
    })
    .join("");

  members.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      removing = { id: button.dataset.remove, name: button.dataset.name };
      const copy = document.querySelector("[data-remove-member-copy]");
      if (copy)
        copy.textContent = `Remove ${removing.name} from ${data.team.name}?`;
      openDialog("remove-member", button);
    });
  });

  scenarioList.innerHTML = data.scenarios
    .map(
      (state, index) =>
        `<li><span class="room-scenario-title">${String(index + 1).padStart(
          2,
          "0",
        )} ${escapeText(titles.get(state.slug) || state.slug)}</span> ${roomState(
          state,
        )}</li>`,
    )
    .join("");

  const solved = data.scenarios.filter((state) => state.team_solved).length;
  certificateLink.hidden = solved < SCENARIO_COUNT;
}

function drawEmpty(message) {
  room = null;
  body.hidden = true;
  empty.hidden = false;
  if (message) announce("Team messages", message);
}

async function loadRoom() {
  const { status, data, outage } = await api("GET", "/api/teams/mine");
  if (outage) {
    announce("Team messages", OUTAGE_COPY, "error");
    return;
  }
  if (status === 404) {
    drawEmpty(hadTeam ? "You are no longer in this team" : "");
    return;
  }
  if (status !== 200 || !data) return;
  drawRoom(data);
}

function setUpCopying() {
  const copyCode = document.querySelector("[data-copy-code]");
  const copyLink = document.querySelector("[data-copy-invite-link]");
  const write = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      /* the clipboard is unavailable; the message still confirms the action */
    }
  };
  copyCode.addEventListener("click", async () => {
    if (!room) return;
    await write(room.team.invite_code);
    announce("Team messages", "Code copied");
  });
  copyLink.addEventListener("click", async () => {
    if (!room) return;
    await write(
      `${location.origin}/downtime?join=${room.team.invite_code}#registration`,
    );
    announce("Team messages", "Invite link copied");
  });
}

function setUpCaptainControls() {
  newCode.addEventListener("click", async () => {
    newCode.disabled = true;
    announce("Team messages", "Issuing new code…");
    const { status, data, outage } = await api(
      "POST",
      "/api/teams/mine/invite-code",
    );
    newCode.disabled = false;
    if (status === 200) {
      code.textContent = data.invite_code;
      if (room) room.team.invite_code = data.invite_code;
      announce("Team messages", "New invite code issued");
      return;
    }
    announce(
      "Team messages",
      outage ? OUTAGE_COPY : REMOVE_ERRORS[data && data.error] || OUTAGE_COPY,
      "error",
    );
  });

  const confirm = document.querySelector("[data-confirm-remove]");
  confirm.addEventListener("click", async () => {
    if (!removing) return;
    confirm.disabled = true;
    announce("Team messages", "Removing…");
    const { status, data, outage } = await api(
      "POST",
      `/api/teams/mine/members/${removing.id}/remove`,
    );
    confirm.disabled = false;
    closeDialog(dialog("remove-member"));
    if (status === 204) {
      announce("Team messages", `${removing.name} was removed`);
      await loadRoom();
      newCode.focus();
      return;
    }
    announce(
      "Team messages",
      outage ? OUTAGE_COPY : REMOVE_ERRORS[data && data.error] || OUTAGE_COPY,
      "error",
    );
  });
}

function setUpLeaving() {
  const open = document.querySelector("[data-leave-team]");
  const confirm = document.querySelector("[data-confirm-leave]");
  open.addEventListener("click", () => openDialog("leave-team", open));
  confirm.addEventListener("click", async () => {
    const name = room ? room.team.name : "";
    confirm.disabled = true;
    announce("Team messages", "Leaving team…");
    const { status, data, outage } = await api("POST", "/api/teams/leave");
    confirm.disabled = false;
    closeDialog(dialog("leave-team"));
    if (status === 204) {
      announce("Team messages", `You left ${name}`);
      location.assign("/downtime#registration");
      return;
    }
    announce(
      "Team messages",
      outage
        ? OUTAGE_COPY
        : data && data.error === "not_in_team"
          ? "You are no longer in this team"
          : OUTAGE_COPY,
      "error",
    );
  });
}

async function start() {
  const me = await startChrome();
  const listed = await api("GET", "/api/scenarios");
  if (listed.data && listed.data.scenarios) {
    titles = new Map(
      listed.data.scenarios.map((scenario) => [scenario.slug, scenario.title]),
    );
  }
  setUpTeamActions({ onJoined: () => loadRoom() });
  setUpCopying();
  setUpCaptainControls();
  setUpLeaving();
  if (!me) {
    drawEmpty("");
  } else {
    await loadRoom();
  }
  connectStream({
    onScore: (score_event) => {
      if (room && room.team.id === score_event.team_id) loadRoom();
    },
    onTeam: (team_event) => {
      if (room && room.team.id === team_event.team_id) loadRoom();
    },
    onOpen: () => {
      if (session()) loadRoom();
    },
    onDrop: () => announce("Team messages", OUTAGE_COPY, "error"),
  });
}

start();
