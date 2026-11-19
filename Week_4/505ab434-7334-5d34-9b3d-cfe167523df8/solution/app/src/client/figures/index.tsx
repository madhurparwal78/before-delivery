import type { ReactNode } from "react";
import { ClearSpaceFigure } from "./ClearSpace.tsx";
import { CurveFigure } from "./Curve.tsx";
import { PaletteFigure } from "./Palette.tsx";
import { TimelineFigure } from "./Timeline.tsx";
import { WeightFigure } from "./Weight.tsx";
import "./figures.css";

/** The live figures of each chapter, after its statements; chapters without figures return nothing. */
export function ChapterFigures({ slug }: { slug: string }): ReactNode {
  switch (slug) {
    case "logo":
      return <ClearSpaceFigure />;
    case "colour":
      return <PaletteFigure />;
    case "typography":
      return <WeightFigure />;
    case "motion":
      return (
        <>
          <TimelineFigure />
          <CurveFigure />
        </>
      );
    default:
      return null;
  }
}
