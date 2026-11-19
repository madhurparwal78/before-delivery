/** Hero brightness, marker visibility and stage observables checked against the live canvas. */
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4173';
let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`); }
};

const run = async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(`${base}/l/seed-buyer-dev-91ae57f3`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const stage = page.locator('[data-role="walkround-stage"]');
    const renderer = await stage.getAttribute('data-renderer');
    if (renderer !== 'webgl') {
      check(`hero brightness skipped at ${w}x${h} (svg renderer)`, true);
      await ctx.close();
      continue;
    }
    const result = await page.evaluate(() => {
      const stageEl = document.querySelector('[data-role="walkround-stage"]');
      const canvas = stageEl.querySelector("canvas");
      if (!canvas) return { ok: false, reason: 'no canvas' };
      const vp = (stageEl.dataset.viewProjection ?? '').split(',').map(Number);
      if (vp.length !== 16) return { ok: false, reason: 'no matrix' };
      const cam = (stageEl.dataset.cameraPosition ?? '').split(',').map(Number);
      const panel = stageEl.dataset.panel ?? '';
      const anchor = (stageEl.dataset.anchor ?? '').split(',').map(Number);
      // Project the hero world point with the published matrix.
      const frames = {
        'bonnet': { o: [-0.75, 0.85, -2.00], U: [1.5, 0, 0], V: [0, 0.1, 1.2] },
        'os-front-wing': { o: [0.85, 0.45, -2.00], U: [0, 0, 1.0], V: [0, 0.4, 0] },
        'os-door': { o: [0.85, 0.40, -1.00], U: [0, 0, 1.2], V: [0, 0.5, 0] },
        'os-sill': { o: [0.85, 0.20, -1.00], U: [0, 0, 2.0], V: [0, 0.2, 0] },
        'os-rear-quarter': { o: [0.85, 0.40, 0.20], U: [0, 0, 1.8], V: [0, 0.5, 0] },
        'boot-lid': { o: [0.70, 0.90, 1.40], U: [-1.4, 0, 0], V: [0, -0.1, 0.6] },
        'rear-bumper': { o: [0.85, 0.30, 2.10], U: [-1.7, 0, 0], V: [0, 0.3, 0] },
        'ns-rear-quarter': { o: [-0.85, 0.40, 2.00], U: [0, 0, -1.8], V: [0, 0.5, 0] },
        'ns-sill': { o: [-0.85, 0.20, 1.00], U: [0, 0, -2.0], V: [0, 0.2, 0] },
        'ns-door': { o: [-0.85, 0.40, 0.20], U: [0, 0, -1.2], V: [0, 0.5, 0] },
        'ns-front-wing': { o: [-0.85, 0.45, -1.00], U: [0, 0, -1.0], V: [0, 0.4, 0] },
        'front-bumper': { o: [-0.85, 0.30, -2.10], U: [1.7, 0, 0], V: [0, 0.3, 0] },
        'roof': { o: [-0.60, 1.30, -0.50], U: [1.2, 0, 0], V: [0, 0, 1.4] },
      };
      const f = frames[panel];
      if (!f) return { ok: false, reason: 'unknown panel ' + panel };
      const world = [
        f.o[0] + anchor[0] * f.U[0] + anchor[1] * f.V[0],
        f.o[1] + anchor[0] * f.U[1] + anchor[1] * f.V[1],
        f.o[2] + anchor[0] * f.U[2] + anchor[1] * f.V[2],
        1,
      ];
      // column-major matrix multiply
      const clip = [];
      for (let row = 0; row < 4; row++) {
        clip.push(vp[row] * world[0] + vp[4 + row] * world[1] + vp[8 + row] * world[2] + vp[12 + row] * world[3]);
      }
      const ndcX = clip[0] / clip[3];
      const ndcY = clip[1] / clip[3];
      const rect = canvas.getBoundingClientRect();
      const px = (ndcX + 1) / 2 * rect.width;
      const py = (1 - ndcY) / 2 * rect.height;
      // Patch samples from the canvas.
      const dpr = canvas.width / rect.width;
      const scaleCtx = (cx, cy) => [cx * dpr, cy * dpr];
      const [hx, hy] = scaleCtx(px, py);
      return {
        ok: true,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        hero: { x: px, y: py },
        deviceHero: { x: hx, y: hy },
        canvasSize: { w: canvas.width, h: canvas.height },
        clipW: clip[3],
        camera: cam,
        angle: Number(stageEl.dataset.cameraAngle),
      };
    });
    if (!result.ok) { check(`stage projection at ${w}x${h}`, false, result.reason ?? ''); await ctx.close(); continue; }
    check(`hero projects inside the canvas at ${w}x${h}`,
      result.hero.x >= 0 && result.hero.x <= result.rect.width && result.hero.y >= 0 && result.hero.y <= result.rect.height,
      JSON.stringify(result.hero));
    check(`hero in front of the camera at ${w}x${h}`, result.clipW > 0, String(result.clipW));

    // Camera angle matches the eye position.
    const [cx, cy, cz] = result.camera;
    const expectedAngle = ((Math.atan2(cx, -cz) * 180) / Math.PI + 360) % 360;
    check(`camera angle matches the eye at ${w}x${h}`, Math.abs(result.angle - expectedAngle) < 1.5, `${result.angle} vs ${expectedAngle.toFixed(2)}`);

    // Hero brightness from the canvas pixels.
    const lum = await page.evaluate(({ dx, dy }) => {
      const stageEl = document.querySelector('[data-role="walkround-stage"]');
      const canvas = stageEl.querySelector('canvas');
      const ctx2 = canvas.getContext('webgl2');
      const gl = ctx2 ?? canvas.getContext('webgl');
      if (!gl) return { ok: false };
      const w = canvas.width;
      const h = canvas.height;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // to an ImageData via a 2d canvas for sampling
      const c2 = document.createElement('canvas');
      c2.width = w; c2.height = h;
      const ictx = c2.getContext('2d');
      const img = ictx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * w * 4;
        img.data.set(buf.subarray(srcRow, srcRow + w * 4), y * w * 4);
      }
      ictx.putImageData(img, 0, 0);
      const sample = (cx0, cy0, size) => {
        const data = ictx.getImageData(cx0 - (size >> 1), cy0 - (size >> 1), size, size).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        return { mean: sum / (data.length / 4) };
      };
      const median = (() => {
        const vals = [];
        const step = Math.max(1, Math.floor(w / 30));
        for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
          const d = ictx.getImageData(x, y, 1, 1).data;
          vals.push(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
        }
        vals.sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
      })();
      const heroPatch = sample(Math.round(dx), Math.round(dy), 31);
      return { ok: true, heroMean: heroPatch.mean, median, w, h };
    }, { dx: result.deviceHero.x, dy: result.deviceHero.y }).catch((e) => ({ ok: false, err: String(e) }));

    if (lum.ok) {
      check(`hero patch mean at least twice the median at ${w}x${h}`, lum.heroMean >= 2 * lum.median,
        `hero ${lum.heroMean.toFixed(1)} vs median ${lum.median.toFixed(1)}`);
      // No patch further than 15% of the canvas width is brighter.
      const elsewhere = await page.evaluate(({ w, h, dx, dy, heroMean }) => {
        const stageEl = document.querySelector('[data-role="walkround-stage"]');
        const canvas = stageEl.querySelector('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) return { ok: false };
        const W = canvas.width;
        const H = canvas.height;
        const buf = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const c2 = document.createElement('canvas');
        c2.width = W; c2.height = H;
        const ictx = c2.getContext('2d');
        const img = ictx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const srcRow = (H - 1 - y) * W * 4;
          img.data.set(buf.subarray(srcRow, srcRow + W * 4), y * W * 4);
        }
        ictx.putImageData(img, 0, 0);
        const sampleMean = (cx0, cy0, size) => {
          const data = ictx.getImageData(cx0 - (size >> 1), cy0 - (size >> 1), size, size).data;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          return sum / (data.length / 4);
        };
        const radius = 0.15 * W;
        let maxElsewhere = 0;
        let worst = '';
        for (let cy0 = 16; cy0 < H - 16; cy0 += 24) {
          for (let cx0 = 16; cx0 < W - 16; cx0 += 24) {
            if (Math.hypot(cx0 - dx, cy0 - dy) <= radius) continue;
            const m = sampleMean(cx0, cy0, 31);
            if (m > maxElsewhere) { maxElsewhere = m; worst = `${cx0},${cy0}`; }
          }
        }
        return { ok: true, maxElsewhere, heroMean, worst };
      }, { w: lum.w, h: lum.h, dx: result.deviceHero.x, dy: result.deviceHero.y, heroMean: lum.heroMean });
      check(`hero not outshone beyond 15% at ${w}x${h}`, elsewhere.ok && elsewhere.maxElsewhere <= lum.heroMean,
        `elsewhere ${elsewhere.maxElsewhere?.toFixed(1)} vs hero ${lum.heroMean.toFixed(1)} at ${elsewhere.worst}`);
    } else {
      check(`hero brightness at ${w}x${h}`, false, 'canvas read failed');
    }
    await ctx.close();
  }

  // Beat progression within a beat: rim glow and card travel rise.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/l/seed-buyer-dev-91ae57f3`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const stage = page.locator('[data-role="walkround-stage"]');
  const glowAt = async (y) => {
    await page.evaluate((scrollY) => { window.scrollTo(0, scrollY); }, y);
    await page.waitForTimeout(450);
    return {
      glow: (await stage.getAttribute('data-rim-glow')) ?? '',
      travel: (await stage.getAttribute('data-card-travel')) ?? '',
      beat: (await stage.getAttribute('data-beat')) ?? '',
    };
  };
  const early = await glowAt(720 + 100);
  const mid = await glowAt(720 + 360);
  const late = await glowAt(720 + 680);
  check('rim glow rises through the beat', Number(early.glow) <= Number(mid.glow) && Number(mid.glow) === 1, `${early.glow} -> ${mid.glow}`);
  check('card travel rises after the hand-off', Number(mid.travel) === 0 && Number(late.travel) > 0, `${mid.travel} -> ${late.travel}`);
  check('beat holds through its range', early.beat === mid.beat && mid.beat === late.beat, `${early.beat}/${mid.beat}/${late.beat}`);

  // Rewind on scrolling back: glow falls again when the same position is revisited.
  const backEarly = await glowAt(720 + 100);
  check('scrolling back rewinds the beat', Math.abs(Number(backEarly.glow) - Number(early.glow)) <= 0.05 && Number(backEarly.travel) === 0, `${backEarly.glow} vs ${early.glow}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => { console.error(err); process.exit(1); });
