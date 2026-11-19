import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion.js";

const CHAPTERS = [["Arrival", 0], ["Volume", 12], ["Caught up", 24]];
const CAPTIONS = [
  "Every record that moves makes a sound.",
  "Rising pitch means more rows are arriving.",
  "Quiet means the pipeline is caught up.",
  "Wayline turns your syncs into signal.",
];

// "Hear your data move": the public-domain sonification film, muted autoplay only without reduced motion.
export default function Film() {
  const video = useRef(null);
  const [muted, setMuted] = useState(true);
  const [transcript, setTranscript] = useState(false);

  useEffect(() => {
    const el = video.current;
    el.muted = true;
    if (!prefersReducedMotion()) el.play().catch(() => {});
  }, []);

  const toggleSound = () => {
    video.current.muted = !muted;
    setMuted(!muted);
  };
  const seek = (seconds) => {
    video.current.currentTime = seconds;
  };

  return (
    <section className="section container" data-reveal>
      <div className="section-head">
        <span className="label eyebrow">Film</span>
        <h2 className="h2">Hear your data move</h2>
        <p className="lede">A NASA data sonification turns X-ray readings into sound — the way Wayline turns each sync into a signal you can follow.</p>
      </div>
      <div className="film">
        <video ref={video} controls muted loop playsInline preload="metadata" src="/media/data-in-sound.webm">
          <track kind="captions" srcLang="en" label="English" src="/media/data-in-sound.en.vtt" default />
          <track kind="chapters" srcLang="en" label="Chapters" src="/media/data-in-sound.chapters.vtt" />
        </video>
        <div className="film-side">
          <button type="button" className="btn btn-outline" aria-pressed={!muted} onClick={toggleSound}>Unmute film</button>
          <ul className="chapters" aria-label="Chapters">
            {CHAPTERS.map(([name, start]) => (
              <li key={name}>
                <button type="button" className="btn btn-quiet" onClick={() => seek(start)}>
                  {name}<span className="code" aria-hidden="true">0:{String(start).padStart(2, "0")}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-outline" aria-expanded={transcript} aria-controls="film-transcript"
            onClick={() => setTranscript(!transcript)}>Show transcript</button>
          <ol id="film-transcript" className="transcript" hidden={!transcript}>
            {CAPTIONS.map((line) => <li key={line}>{line}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}
