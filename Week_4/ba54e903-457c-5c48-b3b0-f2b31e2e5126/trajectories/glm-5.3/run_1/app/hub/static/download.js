/* Download page: platform detection (DP-39). */
"use strict";
(() => {
  const primary = document.getElementById("primaryDownload");
  const others = document.getElementById("otherPlatforms");
  if (!primary || !others) return;
  const platforms = {
    win: "Windows", mac: "macOS", linux: "Linux", android: "Android", ios: "iOS",
  };
  const ua = navigator.userAgent;
  let mine = "Windows";
  if (/Android/i.test(ua)) mine = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) mine = "iOS";
  else if (/Mac OS X/i.test(ua)) mine = "macOS";
  else if (/Linux|X11/i.test(ua)) mine = "Linux";
  primary.textContent = `Download for ${mine}`;
  for (const name of Object.values(platforms)) {
    if (name === mine) continue;
    const li = document.createElement("li");
    li.textContent = name;
    others.appendChild(li);
  }
})();
