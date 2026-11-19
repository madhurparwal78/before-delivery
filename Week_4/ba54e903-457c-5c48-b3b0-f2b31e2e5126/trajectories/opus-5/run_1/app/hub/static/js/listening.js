// The listening room: keyboard-complete, and nothing ever plays on its own.

import { floorClock } from './api.js';

const audio = document.getElementById('player');
const playPause = document.getElementById('play-pause');
const previous = document.getElementById('previous-track');
const nextButton = document.getElementById('next-track');
const seek = document.getElementById('seek');
const volume = document.getElementById('volume');
const nowPlaying = document.getElementById('now-playing');
const equalizer = document.getElementById('equalizer');
const rows = Array.from(document.querySelectorAll('.track'));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let index = 0;

function setEqualizer() {
  const moving = !audio.paused && !reduced.matches;
  equalizer.classList.toggle('moving', moving);
}

function showLengths() {
  rows.forEach((row) => {
    const probe = new Audio(row.dataset.src);
    probe.addEventListener('loadedmetadata', () => {
      row.querySelector('[data-length]').textContent = floorClock(probe.duration);
    });
  });
}

function load(which, play) {
  index = (which + rows.length) % rows.length;
  const row = rows[index];
  audio.src = row.dataset.src;
  nowPlaying.textContent = 'Now playing: ' + row.dataset.title;
  if (play) audio.play().catch(() => {});
}

function updateSeek() {
  const length = audio.duration || 0;
  seek.max = String(Math.max(1, Math.floor(length)));
  seek.value = String(Math.floor(audio.currentTime || 0));
  seek.setAttribute('aria-valuetext',
    floorClock(audio.currentTime) + ' of ' + floorClock(length));
}

playPause.addEventListener('click', () => {
  if (audio.paused) {
    if (!audio.src) load(0, true);
    else audio.play().catch(() => {});
  } else {
    audio.pause();
  }
});

previous.addEventListener('click', () => load(index - 1, !audio.paused || Boolean(audio.src)));
nextButton.addEventListener('click', () => load(index + 1, !audio.paused || Boolean(audio.src)));

for (const row of rows) {
  row.addEventListener('click', () => load(Number(row.dataset.index), true));
}

audio.addEventListener('play', () => {
  playPause.textContent = 'Pause';
  setEqualizer();
});
audio.addEventListener('pause', () => {
  playPause.textContent = 'Play';
  setEqualizer();
});
audio.addEventListener('timeupdate', updateSeek);
audio.addEventListener('loadedmetadata', updateSeek);
audio.addEventListener('ended', () => {
  if (index + 1 < rows.length) load(index + 1, true);
  else {
    playPause.textContent = 'Play';
    setEqualizer();
  }
});

seek.addEventListener('keydown', (event) => {
  const length = audio.duration || 0;
  const moves = {
    ArrowRight: () => Math.min(length, audio.currentTime + 5),
    ArrowLeft: () => Math.max(0, audio.currentTime - 5),
    Home: () => 0,
    End: () => length,
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  audio.currentTime = move();
  updateSeek();
});
seek.addEventListener('input', () => {
  audio.currentTime = Number(seek.value);
  updateSeek();
});

volume.addEventListener('input', () => {
  audio.volume = Number(volume.value) / 100;
});

reduced.addEventListener('change', setEqualizer);

audio.volume = 1;
showLengths();
setEqualizer();
