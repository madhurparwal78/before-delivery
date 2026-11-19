import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { GUMDROP_PALETTE, GUMDROP_SIZE, gumdropCels } from '../../shared/art';
import { parseColour } from '../../shared/colour';
import { reducedMotion } from '../ui';
import { useMe } from '../session';
import { Shell } from './Shell';

/** RGBA pixels of one frame of the hero sprite, layers composited bottom first. */
function spritePixels(frame: number): Uint8ClampedArray<ArrayBuffer> {
  const art = gumdropCels(frame);
  const out = new Uint8ClampedArray(GUMDROP_SIZE * GUMDROP_SIZE * 4);
  for (const rows of [art.shadow, art.body, art.outline]) {
    rows.forEach((row, y) =>
      row.forEach((index, x) => {
        const colour = GUMDROP_PALETTE[index - 1];
        if (!colour) return;
        const [r, g, b, a] = parseColour(colour);
        const at = (y * GUMDROP_SIZE + x) * 4;
        const alpha = a / 255;
        for (const [k, value] of [r, g, b].entries()) out[at + k] = Math.round(value * alpha + (out[at + k] ?? 0) * (1 - alpha) * ((out[at + 3] ?? 0) / 255));
        out[at + 3] = Math.max(out[at + 3] ?? 0, a);
      }),
    );
  }
  return out;
}

const paint = (canvas: HTMLCanvasElement, pixels: Uint8ClampedArray<ArrayBuffer>): void => {
  canvas.getContext('2d')?.putImageData(new ImageData(pixels, GUMDROP_SIZE, GUMDROP_SIZE), 0, 0);
};

/** The hero sprite plays its walk cycle once in under a second and settles on its rest pose. */
function HeroSprite(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paint(canvas, spritePixels(0));
    if (reducedMotion()) return;
    const start = performance.now();
    let frame = 0;
    const tick = (): void => {
      const step = Math.min(8, Math.floor((performance.now() - start) / 100));
      if (step !== frame) {
        frame = step;
        paint(canvas, spritePixels(step % 8));
      }
      if (step < 8) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);
  return <canvas ref={ref} class="hero-sprite" width={GUMDROP_SIZE} height={GUMDROP_SIZE} role="img" aria-label="A pixel gumdrop character" />;
}

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A die-cut sticker: a crop of the hero sprite with a white outline one pixel thick. */
function Sticker({ crop, rotate, class: className }: { crop: Crop; rotate: number; class: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const pad = 2;
    const width = crop.w + pad * 2;
    const height = crop.h + pad * 2;
    const source = spritePixels(0);
    const out = new Uint8ClampedArray(width * height * 4);
    const solid = (x: number, y: number): boolean => {
      const sx = x - pad + crop.x;
      const sy = y - pad + crop.y;
      return sx >= crop.x && sy >= crop.y && sx < crop.x + crop.w && sy < crop.y + crop.h && (source[(sy * GUMDROP_SIZE + sx) * 4 + 3] ?? 0) > 100;
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        if (solid(x, y)) {
          const from = ((y - pad + crop.y) * GUMDROP_SIZE + (x - pad + crop.x)) * 4;
          out.set(source.subarray(from, from + 4), at);
        } else if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => solid(x + dx, y + dy)))) out.set([255, 255, 255, 255], at);
      }
    }
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.putImageData(new ImageData(out, width, height), 0, 0);
  }, [crop.x, crop.y, crop.w, crop.h]);
  return <canvas ref={ref} class={`sticker-art ${className}`} style={{ '--tilt': `${rotate}deg` }} aria-hidden="true" />;
}

const FIELDS = [
  { tone: 'mint', title: 'Everyone paints at once.', line: 'Two cursors, one sprite: every stroke lands for everyone within a second.', stickers: [{ crop: { x: 8, y: 8, w: 14, h: 9 }, rotate: -9, place: 'a' }] },
  { tone: 'cyan', title: 'Change a colour once.', line: 'Edit a swatch and watch it flood across every frame, with the pixels untouched.', stickers: [{ crop: { x: 20, y: 9, w: 9, h: 14 }, rotate: 11, place: 'b' }] },
  { tone: 'lemon', title: 'Build maps from tiles.', line: 'Cut a frame into tiles, then place them with edge matching from the keyboard.', stickers: [{ crop: { x: 9, y: 22, w: 14, h: 8 }, rotate: -6, place: 'a' }] },
  { tone: 'orange', title: 'Pin the review.', line: 'Comments stick to an exact pixel and frame, so feedback never loses its place.', stickers: [{ crop: { x: 12, y: 11, w: 10, h: 7 }, rotate: 8, place: 'b' }] },
  { tone: 'cornflower', title: 'Export what you trust.', line: 'Sheets, GIFs and JSON are listed only after the store confirms every file.', stickers: [{ crop: { x: 6, y: 4, w: 20, h: 22 }, rotate: -12, place: 'a' }] },
] as const;

export function Landing(): JSX.Element {
  const me = useMe();
  return (
    <Shell bare>
      <header class="landing-bar">
        <a href="/" data-route class="wordmark">
          Celmate
        </a>
        <a href={me ? '/projects' : '/signin'} data-route class="pill small">
          {me ? 'Projects' : 'Sign in'}
        </a>
      </header>
      <main>
        <section class="hero">
          <h1>
            <span class="grey">Draw the same sprite,</span> <span class="white">at the same time.</span>
          </h1>
          <HeroSprite />
          <a class="pill huge" href={me ? '/projects' : '/signup'} data-route>
            Start a project
          </a>
          <Sticker crop={{ x: 8, y: 8, w: 14, h: 9 }} rotate={-14} class="hero-sticker s1" />
          <Sticker crop={{ x: 19, y: 20, w: 9, h: 10 }} rotate={12} class="hero-sticker s2" />
          <Sticker crop={{ x: 4, y: 18, w: 12, h: 12 }} rotate={-7} class="hero-sticker s3" />
          <Sticker crop={{ x: 20, y: 6, w: 10, h: 10 }} rotate={17} class="hero-sticker s4" />
        </section>
        {FIELDS.map((field) => (
          <section class={`field ${field.tone}`} key={field.tone}>
            <h2>{field.title}</h2>
            <p>{field.line}</p>
            {field.stickers.map((sticker) => (
              <Sticker key={sticker.place} crop={sticker.crop} rotate={sticker.rotate} class={`field-sticker ${sticker.place}`} />
            ))}
          </section>
        ))}
      </main>
    </Shell>
  );
}
