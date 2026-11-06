// Sign-in page: answers in place, adds the two-step step without a reload, shakes on a refusal.
// The form posts as a plain document when scripts are off; the server applies the return-path rule.
(() => {
  "use strict";
  const reset = document.querySelector("[data-reset]");
  if (reset) {
    reset.addEventListener("submit", (e) => {
      const mismatch = reset.querySelector("[data-mismatch]");
      const same = reset.elements.namedItem("password").value === reset.elements.namedItem("confirm").value;
      mismatch.textContent = same ? "" : "The passwords do not match";
      reset.elements.namedItem("confirm").toggleAttribute("aria-invalid", !same);
      if (!same) e.preventDefault();
    });
  }
  const form = document.querySelector("[data-sign-in]");
  if (!form) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const alertBox = form.querySelector("[data-form-alert]");
  const stepOne = form.querySelector(".step-one");
  const stepTwo = form.querySelector(".step-two");
  const code = form.querySelector("#login-code");
  const codeLabel = form.querySelector("[data-code-label]");
  const useRecovery = form.querySelector("[data-use-recovery]");
  const submit = form.querySelector("[data-submit]");

  const say = (message) => {
    alertBox.textContent = message;
    alertBox.hidden = !message;
  };
  const shake = () => {
    if (!reduce.matches && form.animate) {
      form.animate([{ transform: "none" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" },
        { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }],
      { duration: 420, easing: "ease-in-out" });
    }
  };
  const enterStepTwo = () => {
    stepOne.hidden = true;
    stepTwo.hidden = false;
    code.disabled = false;
    submit.textContent = "Verify";
    code.focus();
  };

  useRecovery.addEventListener("click", (e) => {
    e.preventDefault();
    codeLabel.textContent = "Recovery code";
    code.name = "recovery_code";
    code.inputMode = "text";
    code.value = "";
    useRecovery.hidden = true;
    enterStepTwo();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.dataset.busy) return;
    form.dataset.busy = "1";
    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(new FormData(form)),
        credentials: "same-origin",
      });
      if (res.redirected) {
        window.location.assign(res.url);
        return;
      }
      const answer = new DOMParser().parseFromString(await res.text(), "text/html");
      const refused = answer.querySelector("[data-sign-in]")?.dataset.code;
      const message = answer.querySelector("[data-form-alert]")?.textContent.trim() || "";
      if (refused === "TOTP_REQUIRED" || refused === "BAD_TOTP") {
        say(refused === "BAD_TOTP" ? message : "");
        enterStepTwo();
        if (refused === "BAD_TOTP") shake();
        return;
      }
      say(message);
      shake();
    } catch {
      say("Something went wrong. Try again.");
    } finally {
      delete form.dataset.busy;
    }
  });
})();
