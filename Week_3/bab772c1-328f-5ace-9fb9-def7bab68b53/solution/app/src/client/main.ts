/** Boots the screen named by the server-rendered shell. */

import { renderMissionsPage } from "./missionsPage.js";
import { renderConsole } from "./console.js";

function boot(): void {
  const root = document.getElementById("app");
  if (!root) {
    return;
  }
  const screen = document.body.dataset.screen;
  if (screen === "missions") {
    renderMissionsPage(root);
    return;
  }
  if (screen === "author") {
    const missionId = document.body.dataset.missionId;
    if (missionId) {
      renderConsole(root, { mode: "author", missionId });
    }
    return;
  }
  if (screen === "share") {
    const token = document.body.dataset.shareToken;
    if (token) {
      renderConsole(root, { mode: "share", token });
    }
  }
}

boot();
