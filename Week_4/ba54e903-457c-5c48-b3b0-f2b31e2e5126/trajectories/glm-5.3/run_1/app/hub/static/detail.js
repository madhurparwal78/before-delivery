/* Community detail: join flow with return path (DP-43, DP-92). */
"use strict";
(() => {
  const joinBtn = document.getElementById("joinBtn");
  const status = document.getElementById("joinStatus");
  const slug = location.pathname.split("/").pop();

  function encodeNext(path) {
    return encodeURIComponent(path).replace(/%7E/g, "~");
  }

  if (joinBtn) {
    joinBtn.addEventListener("click", async () => {
      if (!HUB.state.token) {
        const next = `/servers/${slug}?join=1`;
        location.href = "/register?next=" + encodeNext(next);
        return;
      }
      const joined = new URLSearchParams(location.search).get("join") === "1";
      try {
        const resp = await fetch(`/api/servers/${slug}/join`, {
          method: "POST",
          headers: { Authorization: "Bearer " + HUB.state.token, "Content-Type": "application/json" },
          body: "{}",
        });
        const data = await resp.json();
        if (resp.ok) {
          if (status) status.textContent = `You joined ${document.querySelector("h1").textContent}.`;
          const target = `/channels/${data.community_id}/${data.default_channel_id}`;
          history.replaceState({}, "", target);
          location.href = target;
        } else {
          if (status) status.textContent = "You could not join this community.";
        }
      } catch (err) {
        if (status) status.textContent = "You could not join this community.";
      }
    });
  }
})();
