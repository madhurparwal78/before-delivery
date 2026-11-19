import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { asImage } from "../../shared/dots.ts";

const WIDTH_PX = 480;
const SOURCE = /src="([^"]+)"/;

/** Drawings already painted to a bitmap, so a screen with many of them repaints as cheaply as photographs. */
const painted = new Map<string, string>();

function paint(image: HTMLImageElement, drawing: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH_PX;
  canvas.height = Math.round((WIDTH_PX * image.naturalHeight) / image.naturalWidth);
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(image, 0, 0, canvas.width, canvas.height);
  const bitmap = canvas.toDataURL("image/png");
  painted.set(drawing, bitmap);
  return bitmap;
}

/** A dot drawing as a decorative picture in a box its surface has already reserved. */
export function DotImage({ drawing }: { drawing: string }): JSX.Element {
  const [shown, setShown] = useState({ drawing, bitmap: painted.get(drawing) ?? null });
  const bitmap = shown.drawing === drawing ? shown.bitmap : (painted.get(drawing) ?? null);
  return (
    <img
      class="dot-image"
      alt=""
      src={bitmap ?? (SOURCE.exec(asImage(drawing)) as RegExpExecArray)[1]}
      onLoad={(event) => {
        if (!bitmap) setShown({ drawing, bitmap: paint(event.currentTarget, drawing) });
      }}
    />
  );
}
