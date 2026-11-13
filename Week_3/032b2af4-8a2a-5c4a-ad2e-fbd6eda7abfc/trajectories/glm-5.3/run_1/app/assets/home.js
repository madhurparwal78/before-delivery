/* Home page behaviour: hero clip, social buttons, header, consent. */
"use strict";

document.getElementById("headerMount").innerHTML = marketingHeader();
document.getElementById("footerMount").innerHTML = marketingFooter();
document.getElementById("consentMount").innerHTML = consentBar();
injectSharedCss();
mountHeaderBehaviour();
mountRiseIn();

const clip = document.getElementById("heroClip");
const playButton = document.getElementById("playVideoButton");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (clip) {
  if (reduced) {
    clip.pause();
    clip.currentTime = 0;
    playButton.hidden = false;
  } else {
    clip.play().then(() => { playButton.hidden = true; })
            .catch(() => { playButton.hidden = false; });
  }
  playButton.addEventListener("click", () => {
    clip.play().then(() => { playButton.hidden = true; }).catch(() => {});
  });
}

const socialNote = document.getElementById("socialNote");
["googleSignup", "appleSignup"].forEach(id => {
  const b = document.getElementById(id);
  if (b) b.addEventListener("click", () => {
    socialNote.hidden = false;
    socialNote.focus && socialNote.scrollIntoView({ block: "nearest" });
  });
});
