/* Layout: navigation rail, top bar, home poster, sign-in. */
"use strict";

function deskShell(content, activePath) {
  const nav = el("nav", { "aria-label": "Desk" },
    link("Windows", "/windows", activePath === "/windows"),
    link("Review", "/review", activePath === "/review"),
    link("Group", "/group", activePath === "/group"),
    link("Check", "/check", activePath.startsWith("/check")),
  );
  const signOut = el("button", { id: nextId(), text: "Sign out" });
  signOut.addEventListener("click", async () => {
    await api("POST", "/api/auth/sign-out", {});
    ME = null;
    go("/sign-in");
  });
  const menuBtn = el("button", { id: nextId(), text: "Menu" });
  const menuDialog = () => {
    const { dlg } = dialogShell("Menu");
    const close = el("button", { text: "Close" });
    close.addEventListener("click", () => closeDialog(dlg));
    dlg.append(
      link("Windows", "/windows"), link("Review", "/review"),
      link("Group", "/group"), link("Check", "/check"),
      signOut.cloneNode(true),
      close,
    );
    const clones = Array.from(dlg.querySelectorAll("a, button"));
    for (const a of clones) {
      a.addEventListener("click", () => closeDialog(dlg));
    }
    return dlg;
  };
  menuBtn.addEventListener("click", () => openDialog(menuDialog(), menuBtn));

  const topbar = el("div", { class: "topbar" },
    el("div", { class: "topbar-left" }, menuBtn),
    el("div", { class: "topbar-right" }, settlementTimer(), signOut));
  const layout = el("div", { class: "desk" },
    el("aside", { class: "rail" }, nav),
    el("main", { class: "main" }, topbar, content));
  applyLayoutClasses(layout);
  return layout;
}

function applyLayoutClasses() {
  const w = window.innerWidth;
  document.documentElement.dataset.width = w < 768 ? "narrow" : (w < 1200 ? "mid" : "wide");
}

window.addEventListener("resize", applyLayoutClasses);

function link(text, href, active) {
  return el("a", { href, class: active ? "active" : "", text });
}

/* --- Home poster ---------------------------------------------------------- */
async function renderHome() {
  let items = [];
  try { items = (await api("GET", "/api/public/sealed-scores")).items; } catch { }
  const marquee = sealedMarquee(items);
  const headline = el("h1", { class: "hero-headline" },
    el("span", { text: "EVERY HOUR," }),
    el("span", { text: "ACCOUNTED." }));
  const hero = el("section", { class: "hero" },
    el("div", { class: "hero-wordmark", text: "Hourproof" }),
    el("div", { class: "hero-meter", "aria-hidden": "true" }),
    headline,
    el("p", { class: "hero-sentence", text: "A year of clean power means nothing at 3am." }),
    el("a", { class: "hero-button", href: "/sign-in", text: "OPEN THE DESK" }));
  land(el("div", {}, marquee, hero));
}

function sealedMarquee(items) {
  const region = el("section", { "aria-label": "Sealed scores", "data-motion-ms": 45000, class: "marquee" });
  const track = el("div", { class: "marquee-track" });
  if (!items.length) {
    track.append(el("span", { text: "NO SEALED HOURS YET." }));
  } else {
    for (const item of items) {
      track.append(el("span", { text: `${item.site_name} ${item.month} HOUR ${pct(item.hour_bp)}% ` }));
    }
  }
  region.append(track);
  const stop = el("button", { text: "Stop scores" });
  const run = el("button", { text: "Run scores", hidden: true });
  stop.addEventListener("click", () => {
    track.style.animationPlayState = "paused";
    stop.hidden = true; run.hidden = false;
  });
  run.addEventListener("click", () => {
    track.style.animationPlayState = "";
    stop.hidden = false; run.hidden = true;
  });
  const controls = el("div", { class: "marquee-controls" }, stop, run);
  region.addEventListener("mouseenter", () => { track.style.animationPlayState = "paused"; });
  region.addEventListener("mouseleave", () => {
    if (!run.hidden) return;
    track.style.animationPlayState = "";
  });
  return el("div", {}, controls, region);
}

/* --- Sign-in --------------------------------------------------------------- */
function renderSignIn() {
  const email = el("input", { type: "email", id: nextId(), "aria-label": "Email", "data-field": "email" });
  const password = el("input", { type: "password", id: nextId(), "aria-label": "Password", "data-field": "password" });
  const submit = el("button", { text: "Sign in" });
  const problems = el("div", { role: "alert", "aria-label": "Problems to fix", hidden: true });
  const send = async (event) => {
    event.preventDefault();
    problems.hidden = true; problems.replaceChildren();
    try {
      const result = await api("POST", "/api/auth/sign-in", {
        email: email.value, password: password.value,
      });
      ME = result.user;
      go(result.landing_url);
    } catch (err) {
      problems.hidden = false;
      problems.append(document.createTextNode(err.message));
    }
  };
  const form = el("form", {},
    el("h1", { text: "SIGN IN." }),
    el("label", { text: "Email" }), email,
    el("label", { text: "Password" }), password,
    submit, problems);
  form.addEventListener("submit", send);
  land(el("div", { class: "sign-in" }, form));
}

/* --- Not found -------------------------------------------------------------- */
function renderNotFound() {
  land(el("div", { class: "notfound" }, el("h1", { text: "THAT PAGE DOES NOT EXIST." })));
}
