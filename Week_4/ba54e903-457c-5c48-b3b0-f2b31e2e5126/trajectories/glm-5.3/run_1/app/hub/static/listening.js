/* Listening room: keyboard player, live reduced motion (DP-40, DP-69). */
"use strict";
(() => {
  const audio = document.getElementById("loungeAudio");
  const playPause = document.getElementById("playPause");
  const prevBtn = document.getElementById("prevTrack");
  const nextBtn = document.getElementById("nextTrack");
  const seek = document.getElementById("seekSlider");
  const volume = document.getElementById("volumeSlider");
  const list = document.getElementById("trackList");
  const nowPlaying = document.getElementById("nowPlaying");
  const eq = document.getElementById("equalizer");
  if (!audio) return;

  const TRACKS = [
    { title: "Night Shift Lo-fi", file: "/static/gen/track-night-shift-lofi.wav", length: 24 },
    { title: "Aurora Drift", file: "/static/gen/track-aurora-drift.wav", length: 28 },
    { title: "Ronin Rain", file: "/static/gen/track-ronin-rain.wav", length: 22 },
  ];
  let index = 0;

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function renderList() {
    list.textContent = "";
    TRACKS.forEach((track, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", track.title);
      const name = document.createElement("span");
      name.textContent = track.title;
      const desc = document.createElement("span");
      desc.className = "t-desc";
      if (i === 0) desc.textContent = "A late-night study groove with soft keys.";
      if (i === 1) desc.textContent = "Slow synth drift for long evenings.";
      if (i === 2) desc.textContent = "Rainy percussion with a calm pulse.";
      const len = document.createElement("span");
      len.className = "t-len";
      len.textContent = fmtTime(track.length);
      btn.append(name, desc, len);
      btn.addEventListener("click", () => { index = i; startTrack(); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function startTrack() {
    audio.src = TRACKS[index].file;
    audio.volume = Number(volume.value) / 100;
    const play = audio.play();
    if (play && play.catch) play.catch(() => {});
  }

  function syncPlayButton() {
    const playing = !audio.paused && !audio.ended;
    playPause.textContent = playing ? "Pause" : "Play";
    playPause.setAttribute("aria-label", playing ? "Pause" : "Play");
    eq.classList.toggle("paused", !playing);
  }

  function updateSeek() {
    if (!audio.duration || Number.isNaN(audio.duration)) return;
    seek.value = String(Math.round((audio.currentTime / audio.duration) * 100));
    const pos = fmtTime(audio.currentTime);
    const total = fmtTime(audio.duration);
    seek.setAttribute("aria-valuetext", `${pos} of ${total}`);
  }

  playPause.addEventListener("click", () => {
    if (!audio.src) { startTrack(); return; }
    if (audio.paused) {
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      audio.pause();
    }
  });
  prevBtn.addEventListener("click", () => {
    index = (index - 1 + TRACKS.length) % TRACKS.length;
    startTrack();
  });
  nextBtn.addEventListener("click", () => {
    index = (index + 1) % TRACKS.length;
    startTrack();
  });
  seek.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); e.preventDefault(); }
    if (e.key === "ArrowLeft") { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
    if (e.key === "Home") { audio.currentTime = 0; e.preventDefault(); }
    if (e.key === "End") { if (audio.duration) audio.currentTime = audio.duration; e.preventDefault(); }
  });
  volume.addEventListener("keydown", (e) => {
    let value = Number(volume.value);
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { value = Math.min(100, value + 5); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { value = Math.max(0, value - 5); e.preventDefault(); }
    else return;
    volume.value = String(value);
    audio.volume = value / 100;
  });
  volume.addEventListener("input", () => { audio.volume = Number(volume.value) / 100; });

  audio.addEventListener("play", () => {
    syncPlayButton();
    nowPlaying.textContent = `Now playing: ${TRACKS[index].title}`;
  });
  audio.addEventListener("pause", syncPlayButton);
  audio.addEventListener("ended", () => {
    syncPlayButton();
    if (index < TRACKS.length - 1) {
      index += 1;
      startTrack();
    }
  });
  audio.addEventListener("timeupdate", updateSeek);
  audio.addEventListener("loadedmetadata", updateSeek);

  // reduced motion stops the equalizer, never the music
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyMotion = () => {
    eq.classList.toggle("paused", mq.matches || audio.paused);
  };
  mq.addEventListener("change", applyMotion);
  applyMotion();

  renderList();
  syncPlayButton();
})();
