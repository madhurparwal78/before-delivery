import { h } from './dom';
import { icon } from './icons';

const MASTER_GAIN = 0.25;

/** The workshop sound: nothing exists until the first press, then one looping generated noise buffer through one master gain. */
export function soundButton(): HTMLButtonElement {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  const button = h('button', { type: 'button', class: 'bar-button', 'aria-label': 'Workshop sound', 'aria-pressed': 'false' });
  const glyph = () => button.replaceChildren(icon(button.getAttribute('aria-pressed') === 'true' ? 'volume_2' : 'volume_x'));
  glyph();
  button.addEventListener('click', () => {
    if (!context || !master) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(context.destination);
      const samples = context.sampleRate * 2;
      const buffer = context.createBuffer(1, samples, context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < samples; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(master);
      source.start();
      void context.resume();
      button.setAttribute('aria-pressed', 'true');
    } else {
      const on = button.getAttribute('aria-pressed') === 'true';
      master.gain.value = on ? 0 : MASTER_GAIN;
      button.setAttribute('aria-pressed', on ? 'false' : 'true');
    }
    glyph();
  });
  return button;
}
