import { useState, type CSSProperties } from "react";
import { FileCard, Field } from "./art";
import { Link } from "./router";

interface LandingFrame {
  id: string;
  title: string;
  file_card: boolean;
}

const frames: LandingFrame[] = JSON.parse(document.getElementById("landing-frames")?.textContent ?? "[]") as LandingFrame[];
const LIT_AT_LOAD = "Fern gully";

export function Landing() {
  const start = Math.max(
    frames.findIndex((frame) => frame.title === LIT_AT_LOAD),
    0,
  );
  const [lit, setLit] = useState(start);
  return (
    <main className="landing">
      <span className="corner corner-tl brand">Pinsheet</span>
      <Link href="/signin" className="corner corner-tr">
        Sign in
      </Link>
      <div className="strip-window">
        <ul className="strip" style={{ "--centre": start } as CSSProperties}>
          {frames.map((frame, index) => (
            <li key={frame.id}>
              <figure className="strip-frame" aria-label={frame.title} tabIndex={0} data-lit={index === lit ? "true" : "false"} onMouseEnter={() => setLit(index)} onFocus={() => setLit(index)}>
                {frame.file_card ? <FileCard label={frame.title} /> : <Field seed={frame.id} />}
                <figcaption>{frame.title}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
      <p className="corner corner-bl sentence">Boards your group fills together, live.</p>
      <Link href="/signup" className="corner corner-br button">
        Make a board
      </Link>
    </main>
  );
}
