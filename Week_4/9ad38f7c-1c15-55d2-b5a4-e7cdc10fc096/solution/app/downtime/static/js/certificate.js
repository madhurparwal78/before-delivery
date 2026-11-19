// The certificate page: the finished team's certificate and its download, or how many scenarios remain.
import { $, OUTAGE, api, isOutage, listen, signedIn, start, token, utcText } from "./common.js";
import { announce } from "./dialog.js";

start();

const region = $("[data-cert-region]");
const view = $("[data-cert-view]");

async function remaining() {
  const room = await api("/api/teams/mine");
  if (room.status !== 200) return 8;
  return room.data.scenarios.filter((s) => !s.team_solved).length;
}

async function load() {
  if (!signedIn()) return;
  announce(region, "Preparing certificate…");
  const result = await api("/api/me/certificate");
  if (result.status === 200) {
    $("[data-cert-name]").textContent = result.data.display_name;
    $("[data-cert-team]").textContent = result.data.team_name;
    $("[data-cert-issued]").textContent = `Completed ${utcText(result.data.issued_on)}`;
    view.hidden = false;
    announce(region, "");
  } else if (result.status === 403) {
    view.hidden = true;
    const left = await remaining();
    announce(region, `Your team has not completed the event yet. ${left === 1 ? "1 scenario to go" : `${left} scenarios to go`}`);
  } else if (isOutage(result)) {
    announce(region, OUTAGE, "outage");
  }
}

$("[data-download-cert]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  announce(region, "Preparing certificate…");
  try {
    const response = await fetch("/api/me/certificate/image", { headers: { Authorization: `Bearer ${token()}` } });
    if (!response.ok) throw new Error(String(response.status));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = "downtime-certificate.svg";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    announce(region, "");
  } catch {
    announce(region, OUTAGE, "outage");
  } finally {
    button.disabled = false;
  }
});

/* Live: every score event, and every team event for the player's team, reads the certificate again in place. */
async function follow() {
  if (!signedIn()) return;
  const profile = await api("/api/me");
  const teamId = profile.data?.team?.id ?? null;
  listen((name, data) => {
    if (name === "score" || (teamId !== null && data.team_id === teamId)) load();
  }, () => {});
}

load();
follow();
