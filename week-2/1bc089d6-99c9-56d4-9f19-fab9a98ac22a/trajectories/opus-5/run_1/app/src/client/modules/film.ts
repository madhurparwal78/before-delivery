import { connectFilm, duckAmbient } from './audio.js';
import { COPY } from './copy.js';
import { el } from './dom.js';
import { prefersReducedMotion } from './motion.js';

const FILM_SECONDS = 40;

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.min(FILM_SECONDS, Math.floor(seconds)));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** The film dialog and its own player: play, seek, captions, mute, full screen and keys. */
export function filmPlayer(): void {
  const opener = el<HTMLButtonElement>('play-film');
  const dialog = el<HTMLDialogElement>('film-dialog');
  const video = el<HTMLVideoElement>('film-video');
  const play = el<HTMLButtonElement>('film-play');
  const seek = el<HTMLInputElement>('film-seek');
  const time = el('film-time');
  const captions = el<HTMLButtonElement>('film-captions');
  const mute = el<HTMLButtonElement>('film-mute');
  const full = el<HTMLButtonElement>('film-full');
  const close = el<HTMLButtonElement>('film-close');
  const status = el('film-status');

  const track = (): TextTrack | undefined => video.textTracks[0];
  const setCaptions = (on: boolean): void => {
    const cues = track();
    if (cues) cues.mode = on ? 'showing' : 'disabled';
    captions.setAttribute('aria-pressed', String(on));
    status.textContent = on ? COPY.captionsOn : COPY.captionsOff;
  };

  const setPlayLabel = (playing: boolean): void => {
    play.replaceChildren();
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.className = 'film__glyph';
    glyph.textContent = playing ? '❚❚' : '▶';
    play.append(glyph, document.createTextNode(playing ? 'Pause' : 'Play'));
  };

  const showTime = (): void => {
    seek.value = String(Math.floor(video.currentTime));
    seek.setAttribute('aria-valuetext', `${clock(video.currentTime)} of ${clock(FILM_SECONDS)}`);
    time.textContent = clock(video.currentTime);
  };

  const togglePlay = (): void => {
    if (video.paused) void video.play();
    else video.pause();
  };

  const seekBy = (seconds: number): void => {
    video.currentTime = Math.max(0, Math.min(FILM_SECONDS, video.currentTime + seconds));
    showTime();
  };

  const leaveFullScreen = async (): Promise<void> => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  };

  const shut = (): void => {
    video.pause();
    duckAmbient(false);
    void leaveFullScreen();
    dialog.close();
    opener.focus();
  };

  video.addEventListener('play', () => {
    setPlayLabel(true);
    status.textContent = COPY.filmPlaying;
    duckAmbient(true);
  });
  video.addEventListener('pause', () => {
    setPlayLabel(false);
    status.textContent = COPY.filmPaused;
    duckAmbient(false);
  });
  video.addEventListener('timeupdate', showTime);
  video.addEventListener('ended', () => {
    setPlayLabel(false);
    status.textContent = COPY.filmPaused;
  });

  play.addEventListener('click', togglePlay);
  seek.addEventListener('input', () => {
    video.currentTime = Number(seek.value);
    showTime();
  });
  captions.addEventListener('click', () => setCaptions(captions.getAttribute('aria-pressed') !== 'true'));
  mute.addEventListener('click', () => {
    video.muted = !video.muted;
    mute.setAttribute('aria-pressed', String(video.muted));
    status.textContent = video.muted ? COPY.muted : COPY.soundOn;
  });
  full.addEventListener('click', () => {
    if (document.fullscreenElement) void leaveFullScreen();
    else void video.requestFullscreen?.().catch(() => undefined);
  });
  close.addEventListener('click', shut);

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (document.fullscreenElement) void leaveFullScreen();
    else shut();
  });

  dialog.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === ' ' || key === 'k' || key === 'K') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      seekBy(-5);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      seekBy(5);
    } else if (key === 'm' || key === 'M') {
      event.preventDefault();
      mute.click();
    } else if (key === 'c' || key === 'C') {
      event.preventDefault();
      captions.click();
    } else if (key === 'f' || key === 'F') {
      event.preventDefault();
      full.click();
    }
  });

  opener.addEventListener('click', () => {
    dialog.showModal();
    connectFilm(video);
    setPlayLabel(false);
    showTime();
    play.focus();
    if (!prefersReducedMotion()) void video.play();
  });

  setCaptions(false);
  status.textContent = '';
  setPlayLabel(false);
}
