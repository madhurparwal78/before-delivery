#!/usr/bin/env python3
"""Generate the film, the ritual clips, the poster and the app audio.

Everything is drawn from code; no stock assets. Output goes to public/media.
"""
import math
import os
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = "public/media"
W, H = 640, 360
FPS = 24

NIGHT = (27, 21, 38)
VIOLET = (78, 61, 107)
LILAC = (231, 223, 245)
EMBER = (240, 145, 63)
MOON = (246, 234, 217)


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ease(t):
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vertical_gradient(size, top, bottom):
    w, h = size
    rows = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    top = np.array(top, dtype=np.float32)
    bottom = np.array(bottom, dtype=np.float32)
    field = (top[None, None, :] * (1 - rows) + bottom[None, None, :] * rows)
    field = np.repeat(field, w, axis=1)
    img = Image.fromarray(field.astype(np.uint8), "RGB")
    return img


def sky_frame(size, t, horizon, sun_y, glow=1.0, stars=True):
    """A dusk sky with a low ember sun and a few stars."""
    img = vertical_gradient(size, NIGHT, mix(VIOLET, NIGHT, 0.4))
    d = ImageDraw.Draw(img, "RGBA")
    w, h = size
    if stars:
        rng = np.random.default_rng(7)
        pts = rng.uniform(0, 1, (60, 2)) * [w, h * 0.55]
        for (x, y), tw in zip(pts, rng.uniform(0.4, 1.0, len(pts))):
            a = int(140 * tw * (0.6 + 0.4 * math.sin(t * 1.5 + tw * 9)))
            d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=LILAC + (a,))
    # low sun near the horizon
    r = 26
    cx = w * 0.62
    d.ellipse([cx - r, sun_y - r, cx + r, sun_y + r], fill=EMBER + (235,))
    d.ellipse([cx - r - 14, sun_y - r - 14, cx + r + 14, sun_y + r + 14],
              fill=EMBER + (36,))
    # contour ground
    rng = np.random.default_rng(3)
    base = h * horizon
    for k in range(5):
        y0 = base + k * 18
        pts = []
        for x in range(0, w + 20, 20):
            n = math.sin(x * 0.012 + k * 1.7 + 0.8) * 6 + math.sin(x * 0.03 + k) * 3
            pts.append((x, y0 + n))
        d.line(pts, fill=LILAC + (24 + k * 8,), width=1)
    return img


def contour_field(size, t, dim=0.0):
    """Glowing contour lines landscape, dimming with dim (0..1)."""
    img = vertical_gradient(size, NIGHT, mix(NIGHT, VIOLET, 0.5))
    d = ImageDraw.Draw(img, "RGBA")
    w, h = size
    shift = t * 18
    for k in range(26):
        y0 = h * 0.82 - k * 9
        pts = []
        for x in range(0, w + 16, 16):
            n = math.sin((x + shift) * 0.011 + k * 1.3) * 9 + math.sin((x + shift) * 0.027 + k * 0.6) * 4
            pts.append((x, y0 + n))
        a = int(70 * (1 - dim) * (1 - k / 30))
        d.line(pts, fill=EMBER + (a,) if k in (3, 10, 17) else LILAC + (a,), width=1)
    return img


def draw_film_frame(i, total):
    t = i / total
    w, h = W, H
    if t < 0.2:  # dusk landscape, sun sinking
        p = ease(t / 0.2)
        img = sky_frame((w, h), i / total * 0.4, h * (0.62), h * (0.66 + 0.10 * p))
    elif t < 0.4:  # a room: lamp light shrinking
        p = ease((t - 0.2) / 0.2)
        img = vertical_gradient((w, h), NIGHT, mix(VIOLET, NIGHT, 0.3))
        d = ImageDraw.Draw(img, "RGBA")
        d.rectangle([w * 0.3, h * 0.15, w * 0.7, h * 0.85], outline=LILAC + (70,), width=3)
        r = 60 * (1 - p) + 8
        cx, cy = w * 0.5, h * 0.55
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=EMBER + (30 + int(170 * (1 - p)),))
        d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=EMBER + (int(240 * (1 - p)) + 15,))
    elif t < 0.62:  # still water, a boat drifting to centre
        p = ease((t - 0.4) / 0.22)
        img = vertical_gradient((w, h), NIGHT, mix(VIOLET, NIGHT, 0.7))
        d = ImageDraw.Draw(img, "RGBA")
        horizon = h * 0.45
        d.line([0, horizon, w, horizon], fill=LILAC + (40,))
        for k in range(10):
            yy = horizon + 8 + k * (h * 0.05)
            amp = 10 * (1 - p) + 2
            pts = [(x, yy + math.sin(x * 0.05 + i * 0.12 + k) * amp * (k / 10))
                   for x in range(0, w + 10, 10)]
            d.line(pts, fill=LILAC + (int(20 + 25 * (1 - k / 10)),), width=1)
        bx = w * (0.15 + 0.7 * p)
        d.polygon([(bx - 26, horizon + 34), (bx + 26, horizon + 34), (bx + 14, horizon + 44), (bx - 14, horizon + 44)],
                  fill=MOON + (210,))
        d.polygon([(bx - 20, horizon + 34), (bx, horizon + 12), (bx + 20, horizon + 34)], outline=MOON + (210,))
    elif t < 0.82:  # moonflowers closing
        p = ease((t - 0.62) / 0.2)
        img = vertical_gradient((w, h), NIGHT, mix(VIOLET, NIGHT, 0.5))
        d = ImageDraw.Draw(img, "RGBA")
        for k, (fx, fy, fs) in enumerate([(0.2, 0.62, 30), (0.38, 0.7, 24), (0.58, 0.66, 34), (0.78, 0.72, 26)]):
            close = min(1, max(0, (p - k * 0.12) * 2.2))
            petals = 8
            cx, cy, r = w * fx, h * fy, fs
            for q in range(petals):
                ang = q * (2 * math.pi / petals) + k
                pr = r * (1 - close * 0.85)
                px = cx + math.cos(ang) * pr
                py = cy + math.sin(ang) * pr * 0.6
                d.ellipse([px - pr * 0.5, py - pr * 0.5, px + pr * 0.5, py + pr * 0.5],
                          fill=LILAC + (int(200 * (1 - close * 0.7)),))
            d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=EMBER + (200,))
    else:  # lantern, flame shrinking to a point
        p = ease((t - 0.82) / 0.18)
        img = vertical_gradient((w, h), NIGHT, NIGHT)
        d = ImageDraw.Draw(img, "RGBA")
        cx, cy = w * 0.5, h * 0.42
        r = 46
        d.polygon([(cx - r * 0.6, cy), (cx, cy - r * 1.7), (cx + r * 0.6, cy),
                   (cx, cy + r * 1.2)], outline=LILAC + (90,), width=2)
        fr = 16 * (1 - p) + 2
        flick = math.sin(i * 0.9) * 2
        d.ellipse([cx - fr, cy - fr * 1.3 + flick, cx + fr, cy + fr * 1.3 - flick],
                  fill=EMBER + (int(235 * (1 - p)) + 20,))
    return img


def film_caption(i):
    return None


def draw_clip_frame(kind, i, n):
    t = i / n
    w, h = 480, 270
    img = vertical_gradient((w, h), NIGHT, mix(VIOLET, NIGHT, 0.55))
    d = ImageDraw.Draw(img, "RGBA")
    loop = 0.5 - 0.5 * math.cos(2 * math.pi * t)  # smooth loop
    if kind == "dim-lamps":
        for k, (lx, ly) in enumerate([(0.25, 0.4), (0.5, 0.35), (0.72, 0.45)]):
            r = 18 + 10 * math.sin(2 * math.pi * (t + k / 6))
            cx, cy = w * lx, h * ly
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=EMBER + (150,))
            d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=EMBER + (230,))
    elif kind == "warm-shower":
        rng = np.random.default_rng((i * 13) % 997)
        drops = rng.uniform(0, 1, (40, 2)) * [w, h]
        for (x, y) in drops:
            yy = (y + i * 5) % h
            d.line([x, yy, x, yy + 6], fill=LILAC + (90,))
        d.ellipse([w * 0.35, h * 0.25, w * 0.65, h * 0.8], outline=LILAC + (60,), width=3)
    elif kind == "paper-not-pixels":
        d.rectangle([w * 0.3, h * 0.15, w * 0.7, h * 0.85], fill=mix(NIGHT, LILAC, 0.1), outline=LILAC + (90,), width=2)
        for k in range(5):
            x0 = w * 0.36
            yy = h * (0.28 + k * 0.1)
            grow = min(1, max(0, (loop - k * 0.08) * 3))
            d.line([x0, yy, x0 + w * 0.28 * grow, yy], fill=LILAC + (160,), width=3)
        d.line([w * 0.42, h * 0.2, w * 0.42, h * 0.26], fill=EMBER + (140,), width=4)
    elif kind == "tomorrow-list":
        d.rectangle([w * 0.28, h * 0.18, w * 0.72, h * 0.82], outline=LILAC + (80,), width=2)
        for k in range(4):
            bx = w * 0.34
            by = h * (0.3 + k * 0.12)
            checked = loop > k / 5
            d.ellipse([bx, by, bx + 10, by + 10], outline=LILAC + (150,), width=2)
            if checked:
                d.line([bx + 2, by + 5, bx + 4, by + 8, bx + 9, by + 2], fill=EMBER + (220,), width=2)
            d.line([bx + 18, by + 5, bx + 18 + w * 0.22, by + 5], fill=LILAC + (110,), width=2)
    elif kind == "slow-stretch":
        for k, ang in enumerate([0.4, 1.1, 1.8, 2.6, 3.3]):
            ph = math.sin(2 * math.pi * (t + k / 8))
            x0 = w * 0.5 + math.cos(ang) * 60 * (0.5 + 0.5 * ph)
            y0 = h * 0.5 + math.sin(ang) * 40 * (0.5 + 0.5 * ph)
            x1 = w * 0.5 - math.cos(ang) * 60 * (0.5 + 0.5 * ph)
            y1 = h * 0.5 - math.sin(ang) * 40 * (0.5 + 0.5 * ph)
            d.line([x0, y0, x1, y1], fill=LILAC + (110 + k * 20,), width=3)
        d.ellipse([w * 0.5 - 22, h * 0.5 - 22, w * 0.5 + 22, h * 0.5 + 22], fill=EMBER + (90,))
    elif kind == "breathe":
        r = 40 + 50 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
        cx, cy = w * 0.5, h * 0.5
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=LILAC + (200,), width=3)
        d.ellipse([cx - r * 0.55, cy - r * 0.55, cx + r * 0.55, cy + r * 0.55], fill=EMBER + (60,))
    return img


def encode_pngs(frames_dir, audio, out_webm, out_mp4):
    base = ["ffmpeg", "-y", "-framerate", str(FPS), "-start_number", "0", "-i", f"{frames_dir}/%04d.png"]
    vopts = ["-vf", "format=yuv420p"]
    if audio:
        base += ["-i", audio]
    venc_webm = ["-map", "0:v", "-c:v", "libvpx", "-crf", "34", "-b:v", "0"]
    venc_mp4 = ["-map", "0:v", "-c:v", "libx264", "-preset", "veryfast", "-crf", "34",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    run(base + vopts + venc_webm + (["-map", "1:a", "-c:a", "libopus", "-b:a", "48k", "-shortest"] if audio else []) + [out_webm])
    run(base + vopts + venc_mp4 + (["-map", "1:a", "-c:a", "aac", "-b:a", "48k", "-shortest"] if audio else []) + [out_mp4])


def make_audio():
    """Synthesise the ambient bed and three chimes as WAV files."""
    import wave
    sr = 44100

    def save(path, samples):
        data = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
        with wave.open(path, "wb") as fh:
            fh.setnchannels(1)
            fh.setsampwidth(2)
            fh.setframerate(sr)
            fh.writeframes(data.tobytes())

    def env(n, attack, release):
        e = np.ones(n, dtype=np.float32)
        a = max(1, int(sr * attack))
        r = max(1, int(sr * release))
        e[:a] = np.linspace(0, 1, a)
        e[-r:] = np.linspace(1, 0, r)
        return e

    # ambient bed: two low drones, a soft swell, air; loopable
    n = int(sr * 20)
    t = np.arange(n, dtype=np.float32) / sr
    bed = np.zeros(n, dtype=np.float32)
    for f, amp in [(73.42, 0.30), (110.0, 0.22), (146.83, 0.12), (220.0, 0.05)]:
        wob = 1 + 0.004 * np.sin(2 * np.pi * 0.05 * t + f)
        bed += amp * np.sin(2 * np.pi * f * t * wob)
    swell = 0.5 + 0.5 * np.sin(2 * np.pi * t / 20 - np.pi / 2)
    bed *= (0.35 + 0.3 * swell)
    rng = np.random.default_rng(11)
    air = rng.normal(0, 1, n).astype(np.float32)
    kernel = np.ones(2200, dtype=np.float32) / 2200
    air = np.convolve(air, kernel, mode="same") * 0.25
    bed = (bed + air) * env(n, 1.5, 1.5) * 0.5
    save(f"{OUT}/audio/ambient.wav", bed)

    def chime(base, decay, partials, path, dur=1.8):
        n = int(sr * dur)
        tt = np.arange(n, dtype=np.float32) / sr
        s = np.zeros(n, dtype=np.float32)
        for k, (mult, amp) in enumerate(partials):
            s += amp * np.sin(2 * np.pi * base * mult * tt) * np.exp(-tt * (decay + k * 0.9))
        s *= env(n, 0.004, 0.2)
        save(path, s * 0.5)

    chime(329.63, 2.4, [(1, 1.0), (2.01, 0.4), (2.99, 0.2)], f"{OUT}/audio/chime-add.wav")
    chime(440.0, 2.0, [(1, 1.0), (2.76, 0.3), (5.4, 0.12)], f"{OUT}/audio/chime-breath.wav")
    chime(196.0, 1.4, [(1, 1.0), (1.5, 0.5), (2.0, 0.25), (4.2, 0.1)], f"{OUT}/audio/chime-save.wav", 2.4)

    # film soundtrack: 40 s of the bed with an extra low swell and three chimes
    n = int(sr * 40)
    t = np.arange(n, dtype=np.float32) / sr
    track = np.zeros(n, dtype=np.float32)
    for f, amp in [(65.41, 0.26), (98.0, 0.18), (130.81, 0.10)]:
        track += amp * np.sin(2 * np.pi * f * t)
    track *= 0.4 + 0.25 * np.sin(2 * np.pi * t / 40 - np.pi / 2)
    for when, base in [(4.0, 329.63), (16.0, 246.94), (31.0, 220.0)]:
        i0 = int(sr * when)
        dur = 2.0
        m = int(sr * dur)
        tt = np.arange(m, dtype=np.float32) / sr
        s = (np.sin(2 * np.pi * base * tt) * np.exp(-tt * 2.2)
             + 0.3 * np.sin(2 * np.pi * base * 2.01 * tt) * np.exp(-tt * 3.0))
        s *= np.minimum(1, tt / 0.02)
        end = min(n, i0 + m)
        track[i0:end] += s[: end - i0] * 0.22
    track *= env(n, 0.8, 2.0) * 0.55
    save("/tmp/film-track.wav", track)


def main():
    os.makedirs(f"{OUT}/film", exist_ok=True)
    os.makedirs(f"{OUT}/clips", exist_ok=True)
    make_audio()

    # the film: 40 seconds
    total = 40 * FPS
    frames = "/tmp/film-frames"
    os.makedirs(frames, exist_ok=True)
    for i in range(total):
        draw_film_frame(i, total).save(f"{frames}/{i:04d}.png")
    encode_pngs(frames, "/tmp/film-track.wav", f"{OUT}/film/one-still-hour.webm", f"{OUT}/film/one-still-hour.mp4")
    draw_film_frame(0, total).save(f"{OUT}/film/poster.webp", "WEBP", quality=80)

    # the ritual clips: 12 second loops
    clips = ["dim-lamps", "warm-shower", "paper-not-pixels", "tomorrow-list", "slow-stretch", "breathe"]
    for kind in clips:
        frames = f"/tmp/clip-{kind}"
        os.makedirs(frames, exist_ok=True)
        n = 12 * FPS
        for i in range(n):
            draw_clip_frame(kind, i, n).save(f"{frames}/{i:04d}.png")
        encode_pngs(frames, None, f"{OUT}/clips/{kind}.webm", f"{OUT}/clips/{kind}.mp4")
        draw_clip_frame(kind, 0, n).save(f"{OUT}/clips/{kind}-still.webp", "WEBP", quality=75)

    # mp3 versions of the audio for compact delivery
    for name in ["ambient", "chime-add", "chime-breath", "chime-save"]:
        run(["ffmpeg", "-y", "-i", f"{OUT}/audio/{name}.wav", "-c:a", "libmp3lame", "-b:a", "96k",
             f"{OUT}/audio/{name}.mp3"])


if __name__ == "__main__":
    main()

