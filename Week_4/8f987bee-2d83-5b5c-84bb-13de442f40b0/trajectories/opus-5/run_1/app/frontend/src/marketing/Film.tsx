import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/hooks";

const CHAPTERS: { label: string; at: number }[] = [
  { label: "Arrival", at: 0 },
  { label: "Volume", at: 12 },
  { label: "Caught up", at: 24 },
];

const TRANSCRIPT = [
  "Every record that moves makes a sound.",
  "Rising pitch means more rows are arriving.",
  "Quiet means the pipeline is caught up.",
  "Wayline turns your syncs into signal.",
];

export function Film(): JSX.Element {
  const player = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [transcriptShown, setTranscriptShown] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const video = player.current;
    if (!video) return;
    if (reduced) {
      video.pause();
      return;
    }
    video.muted = true;
    void video.play().catch(() => undefined);
  }, [reduced]);

  return (
    <div className="band">
      <p className="eyebrow">Sound</p>
      <h2>Hear your data move</h2>
      <p>A sonification of arriving records: pitch rises as more rows land.</p>
      <video
        ref={player}
        className="film-player"
        controls
        muted={muted}
        loop={!reduced}
        playsInline
        preload="metadata"
      >
        <source src="/media/data-in-sound.webm" type="video/webm" />
        <track kind="captions" src="/media/data-in-sound.en.vtt" srcLang="en" label="English" default />
        <track kind="chapters" src="/media/data-in-sound.chapters.vtt" srcLang="en" label="Chapters" />
      </video>
      <div className="button-row" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="button outline"
          aria-pressed={!muted}
          onClick={() => {
            const nextMuted = !muted;
            setMuted(nextMuted);
            const video = player.current;
            if (video) video.muted = nextMuted;
          }}
        >
          Unmute film
        </button>
        <button type="button" className="button outline" onClick={() => setTranscriptShown((shown) => !shown)}>
          Show transcript
        </button>
      </div>
      <ul className="chapter-list" aria-label="Chapters" style={{ marginTop: "1rem" }}>
        {CHAPTERS.map((chapter) => (
          <li key={chapter.label}>
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                const video = player.current;
                if (video) video.currentTime = chapter.at;
              }}
            >
              {chapter.label}
            </button>
          </li>
        ))}
      </ul>
      {transcriptShown ? (
        <div className="card" style={{ marginTop: "1rem" }}>
          {TRANSCRIPT.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
