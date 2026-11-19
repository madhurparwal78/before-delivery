/* Email confirmation: the page confirms by its own request (DP-06). */
"use strict";
(() => {
  const status = document.getElementById("confirmStatus");
  if (!status) return;
  const params = new URLSearchParams(location.search);
  const token = params.get("token");

  // Replace the address with the bare /verify-email before any request leaves.
  history.replaceState({}, "", "/verify-email");

  if (!token) {
    status.textContent = "This confirmation link is no longer valid.";
    return;
  }
  status.textContent = "Confirming your email…";
  fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).then(async (resp) => {
    if (resp.ok) {
      status.textContent = "Your email is confirmed.";
    } else {
      status.textContent = "This confirmation link is no longer valid.";
    }
  }).catch(() => {
    status.textContent = "Something went wrong. Try again.";
  });
})();
