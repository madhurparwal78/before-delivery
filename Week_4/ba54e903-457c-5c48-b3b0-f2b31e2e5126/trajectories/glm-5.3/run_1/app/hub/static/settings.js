/* Settings: status change and logout with landing history (DP-46, DP-92, DP-93). */
"use strict";
(() => {
  const select = document.getElementById("statusSelect");
  const logout = document.getElementById("logoutBtn");
  if (select) {
    select.addEventListener("change", async () => {
      await fetch("/api/users/@me", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + HUB.state.token, "Content-Type": "application/json" },
        body: JSON.stringify({ status: select.value }),
      }).catch(() => {});
    });
  }
  if (logout) {
    logout.addEventListener("click", async () => {
      // logging out clears every draft in this tab
      const drafts = {};
      const memberKey = "hub_drafts_" + sessionStorage.getItem("hub_member_id");
      const raw = sessionStorage.getItem(memberKey);
      if (raw) {
        try { Object.assign(drafts, JSON.parse(raw)); } catch (e) { /* no drafts */ }
      }
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + HUB.state.token },
      }).catch(() => {});
      HUB.setToken("", null);
      sessionStorage.removeItem(memberKey);
      sessionStorage.removeItem("hub_member_id");
      // Logging out replaces the /settings entry with /login.
      history.replaceState({}, "", "/login");
      location.href = "/login";
    });
  }
})();
