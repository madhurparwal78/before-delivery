/* The certificate page: read again on every score and team event. */

import {
  OUTAGE_COPY,
  announce,
  api,
  connectStream,
  session,
  startChrome,
  token,
  utcTime,
} from "./core.js";

const SCENARIO_COUNT = 8;

const panel = document.querySelector("[data-certificate]");
const nameLine = document.querySelector("[data-certificate-name]");
const teamLine = document.querySelector("[data-certificate-team]");
const eventLine = document.querySelector("[data-certificate-event]");
const timeLine = document.querySelector("[data-certificate-time]");
const download = document.querySelector("[data-download-certificate]");

let watchedTeam = null;

async function remainingScenarios() {
  const { status, data } = await api("GET", "/api/teams/mine");
  if (status !== 200 || !data) return SCENARIO_COUNT;
  return (
    SCENARIO_COUNT - data.scenarios.filter((state) => state.team_solved).length
  );
}

async function refuse() {
  panel.hidden = true;
  const remaining = await remainingScenarios();
  announce(
    "Certificate status",
    `Your team has not completed the event yet. ${
      remaining === 1 ? "1 scenario to go" : `${remaining} scenarios to go`
    }`,
  );
}

async function load() {
  if (!token()) {
    await refuse();
    return;
  }
  announce("Certificate status", "Preparing certificate…");
  const { status, data, outage } = await api("GET", "/api/me/certificate");
  if (outage) {
    panel.hidden = true;
    announce("Certificate status", OUTAGE_COPY, "error");
    return;
  }
  if (status !== 200 || !data) {
    await refuse();
    return;
  }
  nameLine.textContent = data.display_name;
  teamLine.textContent = data.team_name;
  eventLine.textContent = data.event_name;
  timeLine.textContent = `Completed ${utcTime(data.issued_on)}`;
  panel.hidden = false;
  announce("Certificate status", "");
}

function setUpDownload() {
  download.addEventListener("click", async () => {
    const response = await fetch("/api/me/certificate/image", {
      headers: { Authorization: `Bearer ${token()}` },
      cache: "no-store",
    });
    if (!response.ok) {
      announce("Certificate status", OUTAGE_COPY, "error");
      return;
    }
    const file = await response.blob();
    const address = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = address;
    link.download = "downtime-certificate.svg";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(address);
  });
}

async function start() {
  const me = await startChrome();
  watchedTeam = me && me.team ? me.team.id : null;
  setUpDownload();
  await load();
  connectStream({
    onScore: () => load(),
    onTeam: (team) => {
      if (watchedTeam !== null && team.team_id === watchedTeam) load();
      const mine = session();
      if (mine && mine.team && team.team_id === mine.team.id) load();
    },
    onOpen: () => load(),
    onDrop: () => announce("Certificate status", OUTAGE_COPY, "error"),
  });
}

start();
