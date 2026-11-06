"""Synthesise Stillhour's sound: a seamless ambient bed and three soft chimes.

Run from the app root:  uv run --with numpy python scripts/media/synth_audio.py
Writes WAV masters to scripts/media/out/audio/, then MP3s to public/audio/ with ffmpeg.
Everything is generated from sine waves and filtered noise with a fixed seed.
"""
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 44100
BED_SECONDS = 72
OUT = Path("scripts/media/out/audio")
PUBLIC = Path("public/audio")
rng = np.random.default_rng(2126)


def periodic(freq: float) -> float:
    """Snap a frequency so it completes a whole number of cycles in the bed, which makes the loop seamless."""
    return round(freq * BED_SECONDS) / BED_SECONDS


def bed() -> np.ndarray:
    n = RATE * BED_SECONDS
    t = np.arange(n) / RATE
    out = np.zeros((2, n))
    # A low, open drone: root, fifth and octave voices, each a detuned pair that slowly beats.
    voices = [(65.4, 0.30), (98.0, 0.22), (130.8, 0.16), (196.0, 0.07), (261.6, 0.035)]
    swells = [BED_SECONDS, BED_SECONDS / 2, BED_SECONDS / 3, BED_SECONDS / 4]
    for index, (freq, level) in enumerate(voices):
        period = swells[index % len(swells)]
        swell = 0.55 + 0.45 * np.sin(2 * np.pi * t / period + index * 1.7)
        for side, detune in enumerate((-0.18, 0.21)):
            f = periodic(freq + detune * (index + 1) * 0.5)
            phase = rng.uniform(0, 2 * np.pi)
            tone = np.sin(2 * np.pi * f * t + phase)
            tone += 0.18 * np.sin(2 * np.pi * periodic(f * 2) * t + phase * 1.3)
            out[side] += level * swell * tone
    # Air: noise shaped in the frequency domain (circular, so it loops too), a soft band around 300–900 Hz.
    for side in range(2):
        spectrum = np.fft.rfft(rng.normal(size=n))
        freqs = np.fft.rfftfreq(n, 1 / RATE)
        shape = np.exp(-(((np.log(freqs + 1) - np.log(520)) / 0.55) ** 2))
        air = np.fft.irfft(spectrum * shape, n)
        air /= np.max(np.abs(air))
        breath = 0.5 + 0.5 * np.sin(2 * np.pi * t / (BED_SECONDS / 6) + side * np.pi * 0.5)
        out[side] += 0.05 * air * (0.4 + 0.6 * breath)
    # Gentle warmth: soft saturation, then a one-pole low-pass applied circularly.
    out = np.tanh(out * 1.4) / np.tanh(1.4)
    spectrum = np.fft.rfft(out, axis=1)
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= 1 / np.sqrt(1 + (freqs / 2400) ** 2)
    out = np.fft.irfft(spectrum, n, axis=1)
    return out / np.max(np.abs(out)) * 0.7


def bell(notes: list[tuple[float, float, float]], seconds: float, ratio: float = 1.41, index: float = 2.2) -> np.ndarray:
    """FM bell tones: (start seconds, carrier Hz, level), each with an exponentially decaying brightness."""
    n = int(RATE * seconds)
    t = np.arange(n) / RATE
    out = np.zeros(n)
    for start, carrier, level in notes:
        local = np.clip(t - start, 0, None)
        active = t >= start
        decay = np.exp(-local * 3.2)
        attack = np.clip(local / 0.012, 0, 1)
        mod = index * np.exp(-local * 5.0) * np.sin(2 * np.pi * carrier * ratio * local)
        tone = np.sin(2 * np.pi * carrier * local + mod) + 0.25 * np.sin(2 * np.pi * carrier * 2.01 * local)
        out += active * level * attack * decay * tone
    fade = np.clip((seconds - t) / 0.25, 0, 1)
    out *= fade
    return np.stack([out, out]) / np.max(np.abs(out)) * 0.22


def write_wav(path: Path, data: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2").T.copy()
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes(pcm.tobytes())


def encode(source: Path, target: Path, loudness: str | None, bitrate: str):
    target.parent.mkdir(parents=True, exist_ok=True)
    filters = ["-af", f"loudnorm={loudness}"] if loudness else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), *filters, "-ar", str(RATE),
                    "-c:a", "libmp3lame", "-b:a", bitrate, "-map_metadata", "-1", str(target)], check=True)


def main():
    write_wav(OUT / "evening-bed.wav", bed())
    write_wav(OUT / "chime-saved.wav", bell([(0.0, 440.0, 1.0), (0.32, 659.3, 0.8)], 1.4))
    write_wav(OUT / "chime-add.wav", bell([(0.0, 987.8, 1.0)], 0.7, ratio=2.0, index=1.4))
    write_wav(OUT / "chime-breath.wav", bell([(0.0, 293.7, 1.0)], 1.45, ratio=1.0, index=0.8))
    encode(OUT / "evening-bed.wav", PUBLIC / "evening-bed.mp3", "I=-20:TP=-2:LRA=7", "112k")
    for name in ("chime-saved", "chime-add", "chime-breath"):
        encode(OUT / f"{name}.wav", PUBLIC / f"{name}.mp3", None, "96k")


if __name__ == "__main__":
    main()
