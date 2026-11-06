// Garment and object illustrations for the seeded looks (brief: Icons and illustrations), drawn from simple
// shapes in the swatch colours and encoded as PNG. The same figure always gives the same bytes.
import { encodePng } from "./images";

const SWATCH_RGB: Record<string, [number, number, number]> = {
  stone: [0xe9, 0xe5, 0xde],
  ink: [0x16, 0x15, 0x1a],
  vermilion: [0xc4, 0x3a, 0x1c],
  night: [0x0e, 0x14, 0x20],
  moss: [0x4b, 0x53, 0x20],
  sand: [0xd8, 0xc3, 0xa0],
  rust: [0x9a, 0x4a, 0x24],
  fog: [0xc9, 0xcd, 0xd2],
};

type Point = [number, number];
type Rgb = [number, number, number];

class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    ground: Rgb,
  ) {
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) this.data.set([...ground, 255], i * 4);
  }

  private plot(x: number, y: number, rgb: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    for (let c = 0; c < 3; c += 1) this.data[i + c] = Math.round(this.data[i + c] * (1 - alpha) + rgb[c] * alpha);
  }

  /** Even-odd scanline fill of a closed polygon. */
  polygon(points: Point[], rgb: Rgb, alpha = 1): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(this.height - 1, Math.ceil(Math.max(...ys))); y += 1) {
      const scan = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i += 1) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= scan && y2 > scan) || (y2 <= scan && y1 > scan)) xs.push(x1 + ((scan - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x < Math.floor(xs[k + 1] + 0.5); x += 1) this.plot(x, y, rgb, alpha);
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, rgb: Rgb, alpha = 1): void {
    this.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], rgb, alpha);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rgb: Rgb, alpha = 1): void {
    const points: Point[] = [];
    for (let i = 0; i < 72; i += 1) points.push([cx + rx * Math.cos((i / 72) * Math.PI * 2), cy + ry * Math.sin((i / 72) * Math.PI * 2)]);
    this.polygon(points, rgb, alpha);
  }

  /** Hairline seams: thin horizontal rules over a region. */
  seams(x: number, y: number, w: number, h: number, every: number, rgb: Rgb, alpha: number): void {
    for (let yy = y; yy < y + h; yy += every) this.rect(x, yy, w, 2, rgb, alpha);
  }
}

export type Figure = "coat" | "knit" | "trouser" | "cardigan" | "beanie" | "shirt" | "cup" | "overshirt" | "scarf" | "jacket" | "sandal";

const W = 800;
const H = 1000;

function garment(c: Canvas, figure: Figure, main: Rgb, accent: Rgb, line: Rgb): void {
  const top = (len: number, open: boolean): void => {
    c.polygon([[250, 230], [330, 190], [470, 190], [550, 230], [660, 520], [600, 545], [540, 380], [540, 230 + len], [260, 230 + len], [260, 380], [200, 545], [140, 520]], main);
    c.polygon([[330, 190], [400, 290], [470, 190], [440, 190], [400, 250], [360, 190]], accent);
    if (open) c.rect(397, 290, 6, len - 60, line, 0.85);
    c.seams(262, 300, 276, len - 80, 46, line, 0.18);
  };
  switch (figure) {
    case "coat":
      top(560, true);
      c.polygon([[270, 560], [380, 560], [380, 600], [270, 600]], accent, 0.9);
      for (let y = 340; y < 740; y += 90) c.ellipse(420, y, 9, 9, accent);
      break;
    case "knit":
    case "cardigan":
      top(380, figure === "cardigan");
      c.seams(262, 560, 276, 50, 10, line, 0.35);
      c.seams(150, 470, 110, 50, 10, line, 0.3);
      c.seams(540, 470, 110, 50, 10, line, 0.3);
      if (figure === "cardigan") for (let y = 330; y < 600; y += 60) c.ellipse(420, y, 8, 8, accent);
      break;
    case "shirt":
    case "overshirt":
      top(440, true);
      c.rect(300, 330, 70, 60, accent, 0.55);
      c.rect(430, 330, 70, 60, accent, 0.55);
      break;
    case "jacket":
      top(400, true);
      c.rect(280, 470, 90, 70, accent, 0.6);
      c.rect(430, 470, 90, 70, accent, 0.6);
      break;
    case "trouser":
      c.polygon([[280, 200], [520, 200], [560, 860], [440, 860], [400, 360], [360, 860], [240, 860]], main);
      c.rect(280, 200, 240, 36, accent);
      c.rect(397, 240, 6, 120, line, 0.6);
      break;
    case "beanie":
      c.ellipse(400, 470, 210, 200, main);
      c.rect(190, 470, 420, 200, main);
      c.rect(180, 600, 440, 110, accent);
      c.seams(180, 610, 440, 100, 14, line, 0.25);
      c.ellipse(400, 260, 60, 56, accent);
      break;
    case "cup":
      c.polygon([[250, 330], [550, 330], [520, 760], [280, 760]], main);
      c.ellipse(400, 330, 150, 34, accent);
      c.ellipse(400, 330, 128, 24, line, 0.5);
      c.polygon([[540, 420], [640, 440], [640, 600], [525, 640], [530, 600], [600, 575], [600, 470], [535, 460]], main);
      c.ellipse(400, 780, 190, 26, line, 0.18);
      break;
    case "scarf":
      c.polygon([[300, 180], [500, 180], [470, 820], [330, 820]], main);
      c.seams(300, 220, 200, 560, 70, accent, 0.8);
      for (let x = 336; x < 468; x += 22) c.rect(x, 820, 8, 70, main);
      break;
    case "sandal":
      c.ellipse(320, 560, 110, 280, main);
      c.ellipse(500, 560, 110, 280, main);
      c.rect(220, 470, 200, 40, accent);
      c.rect(400, 470, 200, 40, accent);
      c.rect(240, 620, 160, 30, accent);
      c.rect(420, 620, 160, 30, accent);
      break;
  }
}

/** A look illustration: palette ground, a sand floor and the garment. */
export function drawLook(figure: Figure, palette: string[], variant: number): Buffer {
  const [a, b, c] = palette.map((name) => SWATCH_RGB[name] ?? SWATCH_RGB.stone);
  const ground = variant % 2 ? SWATCH_RGB.stone : SWATCH_RGB.fog;
  const canvas = new Canvas(W, H, ground);
  canvas.rect(0, 860 - variant * 40, W, H, SWATCH_RGB.sand, 0.9);
  canvas.ellipse(400, 520, 330, 380, c, 0.28);
  garment(canvas, figure, a, b, SWATCH_RGB.ink);
  return encodePng({ width: W, height: H, data: canvas.data });
}

export const LOOK_SIZE = { width: W, height: H };
