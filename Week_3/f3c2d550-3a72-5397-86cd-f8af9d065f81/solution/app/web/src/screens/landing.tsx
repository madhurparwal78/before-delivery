import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { sizeText, type SizeTenths } from "../../../shared/sizes";
import demo from "../generated/demo.json";
import { useDocumentTitle } from "../hooks";
import { useStopPlayer, type PlayerStop } from "../player";
import { useField } from "../field";

interface DemoStop {
  id: string;
  title: string;
  maker: string;
  year: number;
  size_tenths_mm: SizeTenths;
  swatch: string;
  photo: string;
  srcset: string;
}

const DEMO: readonly DemoStop[] = demo;

const LINES: Record<string, string> = {
  "Desk radio": "A matte textured shell over a brushed fascia, with the parting line tucked behind the tuning scale.",
  "Pocket calculator": "Two-shot keycaps keep their legends for decades because the colour runs all the way through.",
  "Enamel kettle": "Gloss enamel over steel, a beech handle that stays cool, and a lid that seats with a quiet click.",
};

export function LandingScreen() {
  useDocumentTitle("Keep the object, not the picture.");
  const field = useField();
  const sections = useRef<HTMLElement[]>([]);
  const stops = useMemo<PlayerStop[]>(
    () =>
      DEMO.map((stop) => ({
        key: stop.id,
        subject: {
          key: stop.id,
          name: stop.title,
          size: sizeText(stop.size_tenths_mm, "mm"),
          swatch: stop.swatch,
          photo: stop.photo,
          srcSet: stop.srcset,
        },
        identity: { title: stop.title, maker: stop.maker, year: stop.year },
      })),
    [],
  );
  const player = useStopPlayer(stops, () => sections.current.filter(Boolean));

  useEffect(() => {
    player.place(0, false);
  }, [player.place]);

  useEffect(() => {
    field.setNote("Demo photographs are open-access museum images or drawn stand-ins.");
    return () => field.setNote(null);
  }, [field]);

  return (
    <>
      <section className="hero" aria-label="Stowdeck">
        <p className="wordmark">Stowdeck</p>
        <div className="hero-copy">
          <h1>Keep the object, not the picture.</h1>
          <p className="hero-sentence">
            Every photograph keeps its maker, its true size and its finish, so the reference you show a client is the one you can print.
          </p>
          <Link to="/library" className="btn primary">
            Open your deck
          </Link>
        </div>
      </section>
      <div className="demo-sections">
        {DEMO.map((stop, at) => (
          <section
            key={stop.id}
            className="demo-section"
            ref={(element) => {
              if (element) sections.current[at] = element;
            }}
          >
            <h2>{stop.title}</h2>
            <p className="maker">
              {stop.maker}, {stop.year}
            </p>
            <p className="size-line">{sizeText(stop.size_tenths_mm, "mm")}</p>
            <p className="about">{LINES[stop.title]}</p>
          </section>
        ))}
      </div>
    </>
  );
}
