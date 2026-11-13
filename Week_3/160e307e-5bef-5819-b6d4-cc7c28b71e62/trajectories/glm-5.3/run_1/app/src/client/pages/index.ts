import { api, mountOutageBanner, loadingEl, el, pageStatus, focusHeading, type Me } from "../lib/app.js";
import { Modal } from "../lib/modal.js";
import { jsonFetch } from "../lib/app.js";

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  root.textContent = "";
  render(root, me);
  // A magic link's banner arrives as a query parameter.
  const banner = new URLSearchParams(window.location.search).get("banner");
  if (banner !== null) {
    const params = new URLSearchParams(window.location.search);
    if (banner === "database") {
      pageStatus("Online play is unavailable right now. Pass and play still works.", 8000);
    } else {
      pageStatus(banner, 10000);
    }
    params.delete("banner");
    const clean = params.toString();
    window.history.replaceState({}, "", clean.length > 0 ? `/?${clean}` : "/");
  }
  if (me !== null && !me.chosen) {
    window.location.replace("/welcome");
    return;
  }
  focusHeading();
}

function render(root: HTMLElement, me: Me | null): void {
  const page = el("div", { class: "page" });

  if (me !== null) {
    page.appendChild(nav(me));
  }

  // Hero
  const hero = el("section", { class: "field-strip field-cobalt" });
  const h1 = el("h1", { class: "cropped-word" }, "DUE COIN");
  h1.setAttribute("tabindex", "-1");
  const label = el("p", { class: "hero-label" }, "Carrom, refereed in the open.");
  const playNow = el("a", { class: "btn", href: "#pass" }, "Play now");
  playNow.setAttribute("aria-label", "Play now");
  hero.append(h1, label, playNow);
  page.appendChild(hero);

  // PASS field
  const pass = el("section", { class: "field-strip field-tomato", id: "pass" });
  const passWord = el("span", { class: "cropped-word" }, "PASS");
  const passActions = el("div", { class: "field-actions" });
  const passLink = el("a", { class: "btn btn-primary", href: "/play/local" }, "Pass and play");
  passLink.setAttribute("aria-label", "Pass and play");
  passActions.appendChild(passLink);
  pass.append(passWord, passActions);
  page.appendChild(pass);

  // ROOM field
  const room = el("section", { class: "field-strip field-cobalt", id: "room" });
  const roomWord = el("span", { class: "cropped-word" }, "ROOM");
  const roomActions = el("div", { class: "field-actions" });
  const createButton = el("button", { class: "btn btn-primary" }, "Create a room");
  createButton.setAttribute("aria-label", "Create a room");
  const joinLink = el("a", { class: "btn", href: "/join" }, "Join with a code");
  joinLink.setAttribute("aria-label", "Join with a code");
  roomActions.append(createButton, joinLink);
  room.append(roomWord, roomActions);
  page.appendChild(room);

  // RANKED field
  const ranked = el("section", { class: "field-strip field-tomato", id: "ranked" });
  const rankedWord = el("span", { class: "cropped-word" }, "RANKED");
  const rankedActions = el("div", { class: "field-actions" });
  const casualButton = el("button", { class: "btn btn-primary" }, "Play casual");
  casualButton.setAttribute("aria-label", "Play casual");
  const rankedButton = el("button", { class: "btn btn-primary" }, "Play ranked");
  rankedButton.setAttribute("aria-label", "Play ranked");
  rankedActions.append(casualButton, rankedButton);
  ranked.append(rankedWord, rankedActions);
  page.appendChild(ranked);

  root.appendChild(page);

  const onlineDown = (): boolean =>
    document.getElementById("outage-banner")?.style.display === "block";

  const applyOutage = () => {
    const down = onlineDown();
    createButton.disabled = down;
    casualButton.disabled = down;
    rankedButton.disabled = down;
  };
  applyOutage();
  window.setInterval(applyOutage, 1000);

  createButton.addEventListener("click", () => {
    if (onlineDown()) return;
    const dialog = new Modal("Create a room", (dialog, close) => {
      const body = el("div", { class: "form" });
      const legend = el("h2", {}, "Create a room");
      const group = el("div", { class: "radio-group", role: "radiogroup", "aria-label": "Format" });
      const quick = document.createElement("input");
      quick.type = "radio";
      quick.name = "format";
      quick.id = "format-quick";
      quick.value = "quick";
      quick.checked = true;
      quick.setAttribute("aria-label", "Quick");
      const classic = document.createElement("input");
      classic.type = "radio";
      classic.name = "format";
      classic.id = "format-classic";
      classic.value = "classic";
      classic.setAttribute("aria-label", "Classic");
      group.append(quick, el("label", { for: "format-quick" }, "Quick"), classic, el("label", { for: "format-classic" }, "Classic"));
      const create = el("button", { class: "btn btn-primary" }, "Create");
      const closeB = el("button", { class: "btn" }, "Close");
      closeB.setAttribute("aria-label", "Close");
      create.addEventListener("click", async () => {
        create.disabled = true;
        const format = classic.checked ? "classic" : "quick";
        const { status, body } = await jsonFetch<{ code?: string }>(
          "/api/rooms",
          { method: "POST", body: JSON.stringify({ format }) }
        );
        if (status === 201 && body.code !== undefined) {
          window.location.href = `/room/${body.code}`;
          return;
        }
        create.disabled = false;
        pageStatus("Online play is unavailable right now. Pass and play still works.");
        close(false);
      });
      closeB.addEventListener("click", () => close(false));
      body.append(legend, group, create, closeB);
      dialog.addEventListener("close", () => close(false));
      return body;
    }, createButton);
    dialog.open();
  });

  const enterQueue = async (mode: "casual" | "ranked") => {
    if (onlineDown()) return;
    if (mode === "ranked" && me !== null && !me.linked) {
      const dialog = new Modal("Link your email", (dialog, close) => {
        const body = el("div", { class: "form" });
        const heading = el("h2", {}, "Link your email");
        const copy = el("p", {}, "Link your email to play ranked.");
        const emailLabel = el("label", { for: "email-input" }, "Email");
        const emailInput = document.createElement("input");
        emailInput.type = "email";
        emailInput.id = "email-input";
        emailInput.setAttribute("aria-label", "Email");
        const send = el("button", { class: "btn btn-primary" }, "Send link");
        const closeB = el("button", { class: "btn" }, "Close");
        closeB.setAttribute("aria-label", "Close");
        const note = el("div", { role: "alert", class: "error-alert" });
        note.style.display = "none";
        send.addEventListener("click", async () => {
          const email = emailInput.value;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            note.textContent = "Enter a valid email address.";
            note.style.display = "flex";
            return;
          }
          send.textContent = "Sending...";
          send.disabled = true;
          const { status, body: linkBody } = await jsonFetch<{ error?: string }>(
            "/api/auth/link",
            { method: "POST", body: JSON.stringify({ email }) }
          );
          if (status === 202) {
            send.textContent = "Send link";
            send.disabled = false;
            const ok = el("div", { role: "status" }, `Link sent to ${email}. Open it on any device.`);
            body.insertBefore(ok, note);
            note.style.display = "none";
            return;
          }
          send.textContent = "Send link";
          send.disabled = false;
          if (linkBody.error === "MAIL_UNAVAILABLE") {
            note.textContent = "We couldn't send the link. Try again in a minute.";
          } else if (linkBody.error === "EMAIL_INVALID") {
            note.textContent = "Enter a valid email address.";
          } else if (linkBody.error === "ALREADY_LINKED") {
            close(false);
            window.location.href = "/queue/ranked";
            return;
          } else {
            note.textContent = "We couldn't send the link. Try again in a minute.";
          }
          note.style.display = "flex";
        });
        closeB.addEventListener("click", () => close(false));
        dialog.addEventListener("close", () => close(false));
        body.append(heading, copy, emailLabel, emailInput, send, closeB, note);
        return body;
      }, rankedButton);
      dialog.open();
      return;
    }
    const { status } = await jsonFetch("/api/queue", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    if (status === 202) {
      window.location.href = `/queue/${mode}`;
      return;
    }
    pageStatus("Online play is unavailable right now. Pass and play still works.");
  };

  casualButton.addEventListener("click", () => void enterQueue("casual"));
  rankedButton.addEventListener("click", () => void enterQueue("ranked"));
}

function nav(me: Me): HTMLElement {
  const bar = el("nav", { class: "top-bar" });
  const profile = el("a", { href: `/profile/${encodeURIComponent(me.name)}` }, `${me.name} profile`);
  profile.setAttribute("aria-label", `${me.name} profile`);
  bar.appendChild(profile);
  const chalk = el("span", { class: "chip", id: "chalk-balance" }, `${me.chalk} chalk`);
  bar.appendChild(chalk);
  const shop = el("a", { href: "/shop" }, "Shop");
  shop.setAttribute("aria-label", "Shop");
  const leaderboard = el("a", { href: "/leaderboard" }, "Leaderboard");
  leaderboard.setAttribute("aria-label", "Leaderboard");
  bar.append(shop, leaderboard);
  return bar;
}

void main();
