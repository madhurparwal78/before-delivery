/* The team band dialogs: creating a team and joining one with an invite code. */

import {
  OUTAGE_COPY,
  announce,
  api,
  closeDialog,
  dialog,
  openDialog,
  session,
  token,
} from "./core.js";

const SIGN_IN_TARGET = "/login?redirect=%2Fdowntime%23registration";

const CREATE_ERRORS = {
  name_taken: "That team name is taken",
  already_in_team: "One team at a time",
  validation:
    "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores",
};

const JOIN_ERRORS = {
  unknown_invite_code: "That invite code does not match a team",
  already_in_team: "One team at a time",
  team_full: "This team is full",
  validation: "Enter an invite code",
};

function fieldError(form, text) {
  const field = form.querySelector("[data-field-error]");
  if (field) field.textContent = text;
}

function signedIn() {
  return Boolean(token() && session());
}

export function setUpTeamActions({ onJoined }) {
  document.addEventListener("click", (event) => {
    const create = event.target.closest("[data-create-team]");
    const join = event.target.closest("[data-join-team]");
    if (!create && !join) return;
    if (!signedIn()) {
      location.assign(SIGN_IN_TARGET);
      return;
    }
    openDialog(create ? "create-team" : "join-team", create || join);
  });

  const createForm = document.querySelector("[data-create-team-form]");
  if (createForm) {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submit({
        form: createForm,
        field: createForm.querySelector("[data-team-name]"),
        path: "/api/teams",
        payload: (value) => ({ name: value }),
        pending: "Creating team…",
        errors: CREATE_ERRORS,
        onJoined,
      });
    });
  }

  const joinForm = document.querySelector("[data-join-team-form]");
  if (joinForm) {
    joinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submit({
        form: joinForm,
        field: joinForm.querySelector("[data-invite-code]"),
        path: "/api/teams/join",
        payload: (value) => ({ invite_code: value }),
        pending: "Joining team…",
        errors: JOIN_ERRORS,
        onJoined,
      });
    });
  }
}

async function submit({ form, field, path, payload, pending, errors, onJoined }) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  fieldError(form, "");
  announce("Team messages", pending);
  const { status, data, outage } = await api("POST", path, payload(field.value));
  button.disabled = false;
  if (status === 200 || status === 201) {
    announce("Team messages", `Welcome to ${data.team.name}`);
    closeDialog(form.closest("dialog"));
    if (onJoined) onJoined(data.team);
    return;
  }
  const text = outage
    ? OUTAGE_COPY
    : errors[data && data.error] || OUTAGE_COPY;
  announce("Team messages", text, "error");
  fieldError(form, text);
  field.focus();
}

export function openJoinDialog(code) {
  const element = dialog("join-team");
  if (!element) return;
  const field = element.querySelector("[data-invite-code]");
  field.value = code;
  openDialog("join-team", document.activeElement);
  field.focus();
}
