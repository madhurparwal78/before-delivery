/* Listening room: one audio element, three tracks, a keyboard-operable player. */
(function () {
  'use strict';
  var audio = document.getElementById('audio');
  var rows = Array.prototype.slice.call(document.querySelectorAll('#tracks .track'));
  var toggle = document.getElementById('play-toggle');
  var seek = document.getElementById('seek');
  var fill = document.getElementById('seek-fill');
  var volume = document.getElementById('volume');
  var status = document.getElementById('now-playing');
  var equalizer = document.getElementById('eq');
  var SEEK_STEP = 5;
  var index = -1;

  function clock(seconds) {
    var whole = Math.floor(isFinite(seconds) ? seconds : 0);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
  }
  function drawSeek() {
    var length = isFinite(audio.duration) ? audio.duration : 0;
    seek.setAttribute('aria-valuemax', String(length));
    seek.setAttribute('aria-valuenow', String(audio.currentTime));
    seek.setAttribute('aria-valuetext', clock(audio.currentTime) + ' of ' + clock(length));
    fill.style.width = length ? Math.min(100, (audio.currentTime / length) * 100) + '%' : '0';
  }
  function drawState() {
    var playing = !audio.paused;
    toggle.textContent = playing ? 'Pause' : 'Play';
    equalizer.classList.toggle('is-playing', playing);
  }
  function choose(next, play) {
    index = next;
    rows.forEach(function (row, i) { row.classList.toggle('is-current', i === index); });
    audio.src = rows[index].dataset.src;
    status.textContent = 'Now playing: ' + rows[index].dataset.title;
    drawSeek();
    if (play) audio.play().catch(function () { drawState(); });
  }
  function jump(to) {
    if (!isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, to));
    drawSeek();
  }

  rows.forEach(function (row, i) {
    row.querySelector('.track-play').addEventListener('click', function () { choose(i, true); });
  });
  toggle.addEventListener('click', function () {
    if (index < 0) choose(0, true);
    else if (audio.paused) audio.play().catch(drawState);
    else audio.pause();
  });
  document.getElementById('prev-track').addEventListener('click', function () { choose((Math.max(index, 0) + rows.length - 1) % rows.length, true); });
  document.getElementById('next-track').addEventListener('click', function () { choose((index + 1) % rows.length, true); });
  ['play', 'pause', 'ended'].forEach(function (name) { audio.addEventListener(name, drawState); });
  ['timeupdate', 'loadedmetadata', 'durationchange'].forEach(function (name) { audio.addEventListener(name, drawSeek); });
  audio.addEventListener('ended', function () { if (index < rows.length - 1) choose(index + 1, true); });

  seek.addEventListener('keydown', function (event) {
    var handled = true;
    if (event.key === 'ArrowRight') jump(audio.currentTime + SEEK_STEP);
    else if (event.key === 'ArrowLeft') jump(audio.currentTime - SEEK_STEP);
    else if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(audio.duration);
    else handled = false;
    if (handled) event.preventDefault();
  });
  function pointerSeek(event) {
    var box = seek.getBoundingClientRect();
    jump(((event.clientX - box.left) / box.width) * audio.duration);
  }
  seek.addEventListener('pointerdown', function (event) {
    pointerSeek(event);
    seek.setPointerCapture(event.pointerId);
    var move = function (e) { pointerSeek(e); };
    seek.addEventListener('pointermove', move);
    seek.addEventListener('pointerup', function () { seek.removeEventListener('pointermove', move); }, { once: true });
  });
  volume.addEventListener('input', function () { audio.volume = Number(volume.value) / 100; });
  drawState();
})();
