// Draws the three bundled demo photographs as sRGB JPEG/PNG images at least
// 1200px on the long side. Pure JS, no native dependencies.
import { PNG } from "pngjs";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";

const W = 1400, H = 1050;

function png(width, height, paint) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) << 2;
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

// A rounded-rectangle helper over normalised coordinates.
function inRoundRect(x, y, x0, y0, w, h, r) {
  const px = x - x0, py = y - y0;
  if (px < 0 || py < 0 || px > w || py > h) return false;
  const cx = Math.min(Math.max(px, r), w - r), cy = Math.min(Math.max(py, r), h - r);
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r || (px >= r && px <= w - r) || (py >= r && py <= h - r);
}

// Desk radio: matte grey box with a dark grille and dial.
const radio = png(W, H, (x, y) => {
  const bg = [34, 30, 33];
  if (inRoundRect(x, y, 120, 180, 1160, 700, 40)) {
    if (inRoundRect(x, y, 170, 240, 480, 300, 12)) {
      const stripe = Math.floor((x - 170) / 18) % 2;
      return stripe ? [62, 60, 64] : [96, 94, 98];
    }
    if (y > 500 && y < 560 && x > 180 && x < 700) return [210, 205, 200];
    if (inRoundRect(x, y, 800, 460, 380, 180, 90)) return [140, 138, 142];
    if (inRoundRect(x, y, 700, 250, 120, 150, 40)) return [150, 148, 152];
    return [122, 120, 124];
  }
  return bg;
});

// Pocket calculator: black body, two-tone keys.
const calc = png(W, H, (x, y) => {
  const bg = [30, 30, 32];
  if (inRoundRect(x, y, 260, 120, 880, 810, 24)) {
    if (inRoundRect(x, y, 320, 180, 760, 180, 10)) return [44, 74, 60];
    const cx = Math.floor((x - 320) / 190), cy = Math.floor((y - 420) / 130);
    if (x > 320 && x < 1080 && y > 420 && y < 900 && (x - 320) % 190 < 170 && (y - 420) % 130 < 110) {
      return cx === 3 ? [242, 240, 238] : [64, 63, 66];
    }
    return [26, 26, 28];
  }
  return bg;
});

// Enamel kettle: orange body on a dark counter, gloss highlight.
const kettle = png(W, H, (x, y) => {
  const bg = [40, 34, 38];
  const dx = x - 700, dy = y - 640;
  const body = dx * dx / (420 * 420) + dy * dy / (430 * 430) <= 1 && y > 220;
  if (body) {
    const highlight = (x - 560) * (x - 560) / (150 * 150) + (y - 420) * (y - 420) / (220 * 220) <= 1;
    return highlight ? [244, 150, 66] : [214, 106, 34];
  }
  if (y > 620 && y < 660 && x > 380 && x < 1020) return [120, 116, 118];
  if (Math.abs(y - (640 - Math.sqrt(Math.max(0, 1 - ((x - 700) / 620) ** 2)) * 430)) < 8 && x > 340 && x < 1060) return [140, 132, 126];
  return bg;
});

mkdirSync("assets/photos", { recursive: true });
writeFileSync("assets/photos/demo-radio.png", radio);
writeFileSync("assets/photos/demo-calculator.png", calc);
writeFileSync("assets/photos/demo-kettle.png", kettle);
console.log("demo photos written");

// Also emit JPEG versions so the seed exercises the JPEG path (orientation tags etc.).
import jpeg from "jpeg-js";
for (const [name, buf] of [["demo-radio", radio], ["demo-calculator", calc], ["demo-kettle", kettle]]) {
  const img = PNG.sync.read(buf);
  const out = jpeg.encode({ data: img.data, width: img.width, height: img.height }, 90);
  writeFileSync(`assets/photos/${name}.jpg`, out.data);
}
console.log("jpeg versions written");
