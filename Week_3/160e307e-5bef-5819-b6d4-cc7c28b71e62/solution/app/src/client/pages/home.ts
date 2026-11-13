import { ApiFail, post } from "../api";
import { app, loadMe, onOutage, pageStatus } from "../app";
import { h } from "../dom";
import { go } from "../router";
import type { Mount } from "../router";
import { openDialog } from "../ui/dialog";
import { topBar } from "../ui/shell";

function field(id: string, colour: "tomato" | "cobalt", word: string, ...controls: Node[]): HTMLElement {
  return h(
    "section",
    { id, class: `field field-${colour}`, "aria-labelledby": `${id}-word` },
    h("h2", { id: `${id}-word`, class: "giant" }, word),
    h("div", { class: "field-controls" }, ...controls),
  );
}

function formatChoice(name: string): { group: HTMLElement; selected: () => "quick" | "classic" } {
  const radios = (["Quick", "Classic"] as const).map((label, index) => {
    const input = h("input", { type: "radio", name, value: label.toLowerCase(), id: `${name}-${label.toLowerCase()}`, "aria-label": label });
    input.checked = index === 0;
    return { label, input };
  });
  const group = h(
    "div",
    { role: "radiogroup", "aria-label": "Format", class: "segmented" },
    ...radios.map(({ label, input }) => h("label", { class: "segment", for: input.id }, input, h("span", {}, label))),
  );
  return { group, selected: () => (radios[1]?.input.checked ? "classic" : "quick") };
}

function createRoomDialog(opener: HTMLElement): void {
  const choice = formatChoice("room-format");
  const message = h("p", { class: "field-error-text", role: "alert" });
  const create = h("button", { type: "button", class: "btn btn-ink" }, "Create");
  const handle = openDialog(
    { title: "Create a room", returnFocus: opener },
    h("p", { class: "lede" }, "Pick a format. You get a code and a link to share with one friend."),
    choice.group,
    message,
    h("div", { class: "actions" }, create, h("button", { type: "button", class: "btn", onclick: () => handle.close() }, "Close")),
  );
  create.addEventListener("click", async () => {
    create.disabled = true;
    message.textContent = "";
    try {
      const room = await post<{ code: string }>("/api/rooms", { format: choice.selected() });
      handle.close();
      go(`/room/${room.code}`);
    } catch (error) {
      create.disabled = false;
      message.textContent = error instanceof ApiFail && error.status === 503 ? "Online play is unavailable right now." : "We couldn't create the room. Try again.";
    }
  });
}

function linkEmailDialog(opener: HTMLElement): void {
  const email = h("input", { id: "link-email", type: "email", name: "email", autocomplete: "email", class: "text-input" });
  const status = h("p", { class: "status-text", role: "status" });
  const alert = h("p", { class: "field-error-text", role: "alert" });
  const send = h("button", { type: "submit", class: "btn btn-ink" }, "Send link");
  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        status.textContent = "";
        alert.textContent = "";
        send.disabled = true;
        send.textContent = "Sending...";
        send.setAttribute("aria-busy", "true");
        const address = email.value.trim();
        try {
          await post("/api/auth/link", { email: address });
          status.textContent = `Link sent to ${address}. Open it on any device.`;
        } catch (error) {
          alert.textContent =
            error instanceof ApiFail && error.code === "EMAIL_INVALID"
              ? "Enter a valid email address."
              : "We couldn't send the link. Try again in a minute.";
        } finally {
          send.disabled = false;
          send.textContent = "Send link";
          send.removeAttribute("aria-busy");
        }
      },
    },
    h("label", { for: "link-email", class: "label" }, "Email"),
    email,
    status,
    alert,
    h("div", { class: "actions" }, send, h("button", { type: "button", class: "btn", onclick: () => handle.close() }, "Close")),
  );
  const handle = openDialog({ title: "Link your email", returnFocus: opener }, h("p", { class: "lede" }, "Link your email to play ranked."), form);
}

const home: Mount = async ({ root, query }) => {
  const me = app.me;
  const offline = (): boolean => app.outage;
  const playNow = h("a", { href: "#pass", class: "btn btn-tomato" }, "Play now");
  const heading = h("h1", { class: "hero-title", tabindex: -1 }, h("span", {}, "DUE"), " ", h("span", {}, "COIN"));

  const online: HTMLButtonElement[] = [];
  const onlineButton = (label: string, action: (button: HTMLButtonElement) => void): HTMLButtonElement => {
    const button = h("button", { type: "button", class: "btn" }, label);
    button.addEventListener("click", () => action(button));
    button.disabled = offline();
    online.push(button);
    return button;
  };
  const join = h("a", { href: "/join", class: "btn" }, "Join with a code");
  const syncOutage = (): void => {
    for (const button of online) button.disabled = offline();
    join.toggleAttribute("aria-disabled", offline());
    if (offline()) join.setAttribute("aria-disabled", "true");
    else join.removeAttribute("aria-disabled");
  };

  const createRoom = onlineButton("Create a room", (button) => createRoomDialog(button));
  const casual = onlineButton("Play casual", () => go("/queue/casual"));
  const ranked = onlineButton("Play ranked", (button) => (me?.linked ? go("/queue/ranked") : linkEmailDialog(button)));
  join.addEventListener("click", (event) => {
    if (offline()) event.preventDefault();
  });

  root.replaceChildren(
    h(
      "div",
      { class: "home" },
      topBar(false),
      h("section", { class: "hero field-cobalt" }, heading, h("div", { class: "hero-foot" }, h("p", { class: "hero-label" }, "Carrom, refereed in the open."), playNow)),
      field("pass", "tomato", "PASS", h("a", { href: "/play/local", class: "btn" }, "Pass and play")),
      field("room", "cobalt", "ROOM", createRoom, join),
      field("ranked", "tomato", "RANKED", casual, ranked),
    ),
  );
  syncOutage();
  const stop = onOutage(syncOutage);

  const linked = query.get("link");
  if (linked) {
    history.replaceState(null, "", "/");
    await loadMe();
    pageStatus(linked === "signed-in" ? `Signed in as ${app.me?.name ?? ""}` : `Email linked: ${app.me?.email ?? ""}`);
    const chalk = document.getElementById("chalk-balance");
    if (chalk && app.me) chalk.textContent = `${app.me.chalk} chalk`;
  }
  if (app.focusHeading) {
    app.focusHeading = false;
    heading.focus();
  }
  return stop;
};

export default home;

