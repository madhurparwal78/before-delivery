"""Render Stillhour's ritual clips and film from scripts/media/harness.html, then encode them with ffmpeg.

Run from the app root (after synth_audio.py, which the film's soundtrack reuses):
    uv run --with playwright==1.49.1 --with pillow python scripts/media/render_media.py [clips|film|all] [name ...]
Frames are rendered deterministically (fixed time step, fixed seeds) into scripts/media/out/.
"""
import base64
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path.cwd()
HARNESS = ROOT / "scripts/media/harness.html"
OUT = ROOT / "scripts/media/out"
VIDEO = ROOT / "public/video"
IMAGES = ROOT / "public/images"
FPS = 30
CLIPS = {"lamps": 5.0, "shower": 5.0, "paper": 5.0, "list": 5.0, "stretch": 5.0, "breathe": 5.7}
CLIP_SIZE = (640, 400)
FILM_SIZE = (1280, 720)
FILM_SECONDS = 40


def save(data_url: str, path: Path):
    path.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))


def ffmpeg(*args: str):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def render_clip(page, name: str, loop: float):
    frames = OUT / "frames" / name
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir(parents=True)
    page.evaluate("([w, h]) => setup(w, h)", list(CLIP_SIZE))
    count = round(loop * FPS)
    for index in range(count):
        save(page.evaluate("([n, t, l, f]) => renderClip(n, t, l, f)", [name, index / FPS, loop, index]),
             frames / f"{index:04d}.png")
    pattern = str(frames / "%04d.png")
    ffmpeg("-framerate", str(FPS), "-i", pattern, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-row-mt", "1",
           "-deadline", "good", "-cpu-used", "1", "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1",
           str(VIDEO / f"ritual-{name}.webm"))
    ffmpeg("-framerate", str(FPS), "-i", pattern, "-c:v", "libx264", "-preset", "slow", "-crf", "27",
           "-tune", "grain", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-map_metadata", "-1",
           str(VIDEO / f"ritual-{name}.mp4"))
    Image.open(frames / "0000.png").convert("RGB").save(IMAGES / f"ritual-{name}.webp", "WEBP", quality=82, method=6)


def render_film(page):
    frames = OUT / "frames" / "film"
    shutil.rmtree(frames, ignore_errors=True)
    frames.mkdir(parents=True)
    page.evaluate("([w, h]) => setup(w, h)", list(FILM_SIZE))
    for index in range(FILM_SECONDS * FPS):
        save(page.evaluate("(f) => renderFilm(f)", index), frames / f"{index:04d}.jpg")
    pattern = str(frames / "%04d.jpg")
    audio = OUT / "audio" / "film-bed.wav"
    ffmpeg("-i", str(OUT / "audio" / "evening-bed.wav"), "-t", str(FILM_SECONDS),
           "-af", f"afade=t=in:st=0:d=2.5,afade=t=out:st={FILM_SECONDS - 3.5}:d=3.5,loudnorm=I=-20:TP=-2", str(audio))
    common = ["-framerate", str(FPS), "-i", pattern, "-i", str(audio), "-map", "0:v", "-map", "1:a", "-shortest",
              "-map_metadata", "-1"]
    log = str(OUT / "vp9-2pass")
    ffmpeg(*common, "-c:v", "libvpx-vp9", "-b:v", "560k", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1",
           "-pass", "1", "-passlogfile", log, "-an", "-f", "null", "/dev/null")
    ffmpeg(*common, "-c:v", "libvpx-vp9", "-b:v", "560k", "-row-mt", "1", "-deadline", "good", "-cpu-used", "1",
           "-pass", "2", "-passlogfile", log, "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "64k",
           str(VIDEO / "one-still-hour.webm"))
    ffmpeg(*common, "-c:v", "libx264", "-preset", "slow", "-b:v", "580k", "-maxrate", "900k", "-bufsize", "1800k",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
           str(VIDEO / "one-still-hour.mp4"))
    Image.open(frames / f"{int(15.6 * FPS):04d}.jpg").convert("RGB").save(
        IMAGES / "film-poster.webp", "WEBP", quality=84, method=6)


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    names = sys.argv[2:] or list(CLIPS)
    VIDEO.mkdir(parents=True, exist_ok=True)
    IMAGES.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--allow-file-access-from-files", "--use-angle=metal", "--enable-gpu"])
        page = browser.new_page()
        page.goto(HARNESS.as_uri())
        page.evaluate("() => window.ready")
        if what in ("clips", "all"):
            for name in names:
                render_clip(page, name, CLIPS[name])
                print("clip", name, flush=True)
        if what in ("film", "all"):
            render_film(page)
            print("film", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
