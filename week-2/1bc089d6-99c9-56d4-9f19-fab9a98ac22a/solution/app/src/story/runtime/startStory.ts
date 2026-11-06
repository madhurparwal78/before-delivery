import { film } from "../content";
import { Disposables, query, queryAll } from "./Disposables";
import { initBreathe } from "./dom/breathe";
import { initFilm } from "./dom/film";
import { initGate } from "./dom/gate";
import { initNumerals } from "./dom/numerals";
import { initReveals, revealHero, splitLetters } from "./dom/reveals";
import { initScrollDom } from "./dom/scrollDom";
import { Sound } from "./dom/sound";
import { initTrack } from "./dom/track";
import { startFrameLoop } from "./frameLoop";
import { createStage, measureStage, type SceneId } from "./stage";
import { initSmoothScroll, initViewport } from "./viewport";
import { Experience } from "./webgl/Experience";
import { detectQuality } from "./webgl/quality";
import { SCENES } from "./webgl/scenes";

/** The faces the story sets, each loaded (and counted by the gate) before the letters are split. */
const FONT_FACES = ['400 1em "Fraunces"', 'italic 400 1em "Fraunces"', '400 1em "Hanken Grotesk"'];

/** Resolves when an image has loaded or failed (a failure must not hold the gate). */
const loadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = src;
  });

/**
 * Boots the story: quality detection, the fixed WebGL canvas and its scenes, smooth scrolling, the
 * per-frame scroll layer, sound, reveals, the guided breath, the ritual cards and the film. One frame
 * loop drives everything. The gate stays up until fonts, sounds, the film's poster and every scene are
 * ready. Returns the teardown.
 */
export function startStory() {
  const disposables = new Disposables();
  const root = document.documentElement;
  const quality = detectQuality();
  root.classList.add("js");
  root.classList.toggle("is-reduced", quality.reduced);
  root.classList.toggle("no-webgl", !quality.webgl);
  root.classList.toggle("is-software", quality.software);

  initViewport(disposables);
  const stage = createStage();
  const windows = new Map(queryAll("[data-scene]").map((element) => [element.dataset.scene as SceneId, element]));
  const experience = quality.webgl ? new Experience(query<HTMLCanvasElement>(".sh-canvas"), quality, disposables) : null;
  const sound = new Sound(disposables);
  const lenis = initSmoothScroll(disposables, quality);
  lenis?.stop();
  const scrollPageTo = (y: number) => {
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
  };

  disposables.listen<MouseEvent>(query(".sh-skip"), "click", (event) => {
    event.preventDefault();
    scrollPageTo(query<HTMLElement>("#plan").getBoundingClientRect().top + window.scrollY);
    query("#sh-ch6-title").focus({ preventScroll: true });
  });
  const followPointer = (event: PointerEvent) => {
    stage.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    stage.pointer.y = 1 - (event.clientY / window.innerHeight) * 2;
  };
  disposables.listen(window, "pointermove", followPointer, { passive: true });
  disposables.listen(window, "pointerdown", followPointer, { passive: true });
  disposables.listen(window, "stillhour:hour-saved", () => sound.chime("saved"));

  const scrollDom = initScrollDom(disposables, quality.reduced, scrollPageTo);
  const numerals = initNumerals(disposables, quality.reduced);
  initBreathe(disposables, sound);
  initTrack(disposables, sound, quality.reduced);
  initFilm(disposables, sound, quality.reduced);

  const gate = initGate(disposables, quality.reduced, sound.remembered, (withSound) => {
    sound.setEnabled(withSound);
    lenis?.start();
    revealHero(quality.reduced);
    numerals.refresh();
  });

  let stopped = false;
  const tasks: Array<Promise<unknown>> = [];
  let done = 0;
  const total = FONT_FACES.length + sound.files.length + 1 + (experience ? Object.keys(SCENES).length : 0);
  const step = () => {
    done += 1;
    gate.setProgress(done / total);
  };
  const fonts = FONT_FACES.map((face) =>
    document.fonts
      .load(face)
      .catch(() => [])
      .then(step),
  );
  tasks.push(
    ...fonts,
    Promise.all(fonts).then(() => {
      if (stopped) return;
      splitLetters();
      scrollDom.settleLetters();
      initReveals(disposables, quality.reduced);
      scrollDom.measureTrack();
    }),
  );
  sound.files.forEach((url) => tasks.push(sound.load(url).then(step)));
  tasks.push(loadImage(film.poster).then(step));
  if (experience) {
    tasks.push(
      experience.build(SCENES, step).catch(() => {
        root.classList.add("no-webgl");
      }),
    );
  }
  void Promise.all(tasks).then(() => {
    if (!stopped) gate.ready();
  });

  let elapsed = 0;
  let marked: string | undefined;
  const stopLoop = startFrameLoop((time, deltaMs) => {
    const delta = Math.min(deltaMs, 100) / 1000;
    lenis?.raf(time);
    if (!quality.reduced) elapsed += delta;
    measureStage(stage, windows);
    // Without WebGL the fixed layer shows a flat drawing of the scene on screen (see story.css).
    const scene = stage.current ?? "";
    if (scene !== marked) root.dataset.scene = marked = scene;
    scrollDom.update(stage);
    experience?.render(stage, elapsed, quality.reduced ? 0 : delta);
  });

  return () => {
    stopped = true;
    stopLoop();
    disposables.dispose();
    experience?.dispose();
  };
}
