// "Create a team" and "Join an existing team": dialogs when signed in, the login page otherwise.
import { $, OUTAGE, api, isOutage, signedIn } from "./common.js";
import { announce, openDialog } from "./dialog.js";

const CREATE = {
  dialog: "#create-team-dialog", path: "/api/teams", field: "name", pending: "Creating team…",
  errors: {
    name_taken: "That team name is taken",
    already_in_team: "One team at a time",
    validation: "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores",
  },
};
const JOIN = {
  dialog: "#join-team-dialog", path: "/api/teams/join", field: "invite_code", pending: "Joining team…",
  errors: {
    unknown_invite_code: "That invite code does not match a team",
    already_in_team: "One team at a time",
    team_full: "This team is full",
    validation: "Enter an invite code",
  },
};

function open(kind, opener) {
  const dialog = $(kind.dialog);
  const form = $("form", dialog);
  const field = form.elements[kind.field];
  const region = $("[data-region]", form);
  const submit = $("button[type='submit']", form);
  form.reset();
  announce(region, "");
  openDialog(dialog, opener);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    announce(region, kind.pending);
    const result = await api(kind.path, { method: "POST", body: { [kind.field]: field.value } });
    submit.disabled = false;
    if (result.status === 200 || result.status === 201) {
      announce(region, `Welcome to ${result.data.team.name}`, "success");
      window.location.assign("/downtime/team");
      return;
    }
    announce(region, isOutage(result) ? OUTAGE : kind.errors[result.data?.error] ?? OUTAGE, "error");
    field.focus();
  };
}

/**
 * An invite link `?join=<code>` on the event page: the parameter always leaves the address by replacement; a valid
 * code opens the join dialog filled in (signed in) or goes through sign-in and comes back (signed out).
 */
export function acceptInviteLink() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("join")) return;
  const value = url.searchParams.get("join");
  url.searchParams.delete("join");
  window.history.replaceState(window.history.state, "", url);
  if (!/^[A-Za-z0-9]{8}$/.test(value)) return;
  const code = value.toUpperCase();
  if (!signedIn()) {
    window.location.assign(`/login?redirect=${encodeURIComponent(`/downtime?join=${code}#registration`)}`);
    return;
  }
  const openFilled = () => {
    open(JOIN, null);
    $(JOIN.dialog).querySelector("[name='invite_code']").value = code;
  };
  // The browser's scroll to the address fragment during load drops focus, so the dialog opens after it.
  if (document.readyState === "complete") openFilled();
  else window.addEventListener("load", () => setTimeout(openFilled, 0), { once: true });
}

export function wireTeamBand() {
  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-create-team], [data-join-team]");
    if (!opener) return;
    if (!signedIn()) {
      window.location.assign("/login?redirect=%2Fdowntime%23registration");
      return;
    }
    open(opener.hasAttribute("data-create-team") ? CREATE : JOIN, opener);
  });
}
