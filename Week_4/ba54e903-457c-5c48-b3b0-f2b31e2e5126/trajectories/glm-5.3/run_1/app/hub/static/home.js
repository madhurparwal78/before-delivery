/* Home page: hero video, word strip, reduced motion (DP-39, DP-69). */
"use strict";
(() => {
  const video = document.getElementById("heroVideo");
  const pauseBtn = document.getElementById("videoPause");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function applyVideoState(userPaused) {
    if (!video) return;
    if (reduced()) {
      if (!video.paused) video.pause();
      video.removeAttribute("autoplay");
      if (pauseBtn) pauseBtn.textContent = "Play background video";
    } else if (!userPaused) {
      const play = video.play();
      if (play && play.catch) play.catch(() => {});
      if (pauseBtn) pauseBtn.textContent = "Pause background video";
    }
  }
  let userPaused = false;
  if (video && pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      userPaused = !video.paused;
      if (video.paused) {
        video.play().then(() => {
          pauseBtn.textContent = "Pause background video";
        }).catch(() => {});
        userPaused = false;
      } else {
        video.pause();
        pauseBtn.textContent = "Play background video";
        userPaused = true;
      }
    });
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", () => applyVideoState(userPaused));
    applyVideoState(false);
  }
})();
