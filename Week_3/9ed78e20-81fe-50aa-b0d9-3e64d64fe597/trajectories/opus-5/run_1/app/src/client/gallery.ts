import { all, one, setStatus } from './dom.js';

export function startGallery(): void {
  const players = all<HTMLAudioElement>('[data-sample-audio]');
  for (const sample of all('.sample')) {
    const audio = one<HTMLAudioElement>('[data-sample-audio]', sample);
    const play = one<HTMLButtonElement>('[data-sample-play]', sample);
    const pause = one<HTMLButtonElement>('[data-sample-pause]', sample);
    if (audio !== null && play !== null && pause !== null) {
      play.addEventListener('click', () => {
        for (const other of players) {
          if (other !== audio) other.pause();
        }
        void audio.play();
      });
      pause.addEventListener('click', () => audio.pause());
    }

    const view = one('[data-frame-view]', sample);
    if (view === null) continue;
    const frames = all<HTMLImageElement>('img', view);
    const status = one('[data-frame-status]', sample);
    let current = 0;
    const show = (index: number): void => {
      current = (index + frames.length) % frames.length;
      for (const [position, frame] of frames.entries()) {
        frame.hidden = position !== current;
      }
      setStatus(status, `Frame ${current + 1} of ${frames.length}`);
    };
    const previous = one<HTMLButtonElement>('[data-frame-previous]', sample);
    const next = one<HTMLButtonElement>('[data-frame-next]', sample);
    if (previous !== null) previous.addEventListener('click', () => show(current - 1));
    if (next !== null) next.addEventListener('click', () => show(current + 1));
    view.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        show(current - 1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        show(current + 1);
      }
    });
    show(0);
  }
}
