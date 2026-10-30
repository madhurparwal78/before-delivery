import { film } from "../../content";
import { keepTabInside } from "../../../shared/dialog";
import { type Disposables, query } from "../Disposables";
import type { Sound } from "./sound";

const SEEK_STEP = 5;

const clock = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/**
 * The film: "Play the film" opens a modal dialog with a custom player (play/pause, seek, captions, mute,
 * full screen and keyboard keys), whose results are announced in "Film status". Tab stays inside the
 * dialog; Escape leaves full screen first, then closes and returns focus to the opener. The film's sound
 * runs through the story's master volume and the ambient bed drops while it plays.
 */
export function initFilm(disposables: Disposables, sound: Sound, reduced: boolean) {
  const trigger = query<HTMLButtonElement>("[data-film-open]");
  const dialog = query<HTMLDialogElement>(".sh-film__dialog");
  const player = query(".sh-player", dialog);
  const video = query<HTMLVideoElement>(".sh-player__video", player);
  const play = query<HTMLButtonElement>("[data-player='play']", player);
  const playLabel = query("[data-player-label]", play);
  const captions = query<HTMLButtonElement>("[data-player='captions']", player);
  const mute = query<HTMLButtonElement>("[data-player='mute']", player);
  const fullscreen = query<HTMLButtonElement>("[data-player='fullscreen']", player);
  const close = query<HTMLButtonElement>("[data-player='close']", player);
  const seek = query<HTMLInputElement>("[data-player-seek]", player);
  const current = query("[data-player-current]", player);
  const duration = query("[data-player-duration]", player);
  const status = query("[data-film-status]", dialog);
  let seeking = false;

  const say = (text: string) => {
    status.textContent = text;
  };

  const setState = (state: string) => {
    player.dataset.state = state;
    playLabel.textContent = state === "playing" ? "Pause" : "Play";
  };

  /** The film's own length, once its metadata has loaded (0 before). */
  const total = () => (Number.isFinite(video.duration) ? video.duration : 0);

  const syncTime = () => {
    current.textContent = clock(video.currentTime);
    duration.textContent = clock(total());
    if (!seeking && total() > 0) seek.value = String(Math.round((video.currentTime / total()) * 1000));
    seek.setAttribute("aria-valuetext", `${clock(video.currentTime)} of ${clock(total())}`);
  };

  const seekTo = (seconds: number) => {
    video.currentTime = Math.min(Math.max(0, seconds), total());
    syncTime();
  };

  const togglePlay = () => {
    if (video.paused || video.ended) {
      sound.route(video);
      setState("loading");
      void video.play().catch(() => setState("paused"));
    } else {
      video.pause();
    }
  };

  const setCaptions = (on: boolean, announce = true) => {
    const track = video.textTracks[0];
    if (track) track.mode = on ? "showing" : "hidden";
    player.dataset.captions = on ? "on" : "off";
    captions.setAttribute("aria-pressed", String(on));
    if (announce) say(on ? film.copy.captionsOn : film.copy.captionsOff);
  };

  const setMuted = (muted: boolean) => {
    video.muted = muted;
    player.dataset.muted = String(muted);
    mute.setAttribute("aria-pressed", String(muted));
    say(muted ? film.copy.muted : film.copy.soundOn);
  };

  const open = () => {
    dialog.showModal();
    say("");
    setCaptions(false, false);
    if (video.readyState === 0) {
      video.preload = "auto";
      video.load();
    }
    syncTime();
    play.focus();
    if (!reduced) togglePlay();
  };

  disposables.listen(trigger, "click", open);
  disposables.listen(close, "click", () => dialog.close());
  disposables.listen(dialog, "cancel", (event) => {
    if (!document.fullscreenElement) return;
    event.preventDefault();
    void document.exitFullscreen();
  });
  disposables.listen(dialog, "close", () => {
    video.pause();
    if (document.fullscreenElement) void document.exitFullscreen();
    sound.filmPlays(false);
    trigger.focus();
  });
  disposables.listen(dialog, "click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  disposables.listen(play, "click", togglePlay);
  disposables.listen(video, "click", togglePlay);
  disposables.listen(captions, "click", () => setCaptions(player.dataset.captions !== "on"));
  disposables.listen(mute, "click", () => setMuted(!video.muted));
  disposables.listen(fullscreen, "click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player.requestFullscreen?.();
  });

  disposables.listen(seek, "input", () => {
    seeking = true;
    seekTo((Number(seek.value) / 1000) * total());
  });
  disposables.listen(seek, "change", () => {
    seeking = false;
  });

  disposables.listen(video, "playing", () => {
    setState("playing");
    sound.filmPlays(true);
    say(film.copy.playing);
  });
  disposables.listen(video, "pause", () => {
    setState("paused");
    sound.filmPlays(false);
    say(film.copy.paused);
  });
  disposables.listen(video, "ended", () => {
    setState("ended");
    sound.filmPlays(false);
  });
  disposables.listen(video, "waiting", () => setState("loading"));
  disposables.listen(video, "timeupdate", syncTime);
  disposables.listen(video, "seeked", syncTime);
  disposables.listen(video, "loadedmetadata", syncTime);

  disposables.listen<KeyboardEvent>(dialog, "keydown", (event) => {
    const target = event.target as Element;
    const onControl = target.closest("button, input");
    if (event.key === "Tab") keepTabInside(dialog, event);
    else if ((event.key === " " && !onControl) || event.key === "k" || event.key === "K") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(video.currentTime + (event.key === "ArrowLeft" ? -SEEK_STEP : SEEK_STEP));
    } else if (event.key === "m" || event.key === "M") {
      setMuted(!video.muted);
    } else if (event.key === "c" || event.key === "C") {
      setCaptions(player.dataset.captions !== "on");
    } else if (event.key === "f" || event.key === "F") {
      fullscreen.click();
    }
  });

  disposables.add(() => {
    if (dialog.open) dialog.close();
  });
}
