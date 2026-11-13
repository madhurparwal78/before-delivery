// `region "Release notes"`: a dark band with one tag message per slide as a large headline led by a gradient `//`, a mono
// `<i> / <n>` counter and two round outlined arrows. It wraps, and ArrowLeft / ArrowRight work wherever focus is inside it.
import { useState } from "preact/hooks";
import { Icon } from "../../ui/icons.tsx";
import type { Tag } from "./types.ts";

export function ReleaseNotes({ tags }: { tags: readonly Tag[] }) {
  const [index, setIndex] = useState(0);
  const [moved, setMoved] = useState(false);
  const count = tags.length;
  const step = (by: number) => {
    setIndex((current) => (current + by + count) % count);
    setMoved(true);
  };
  const tag = tags[index];
  if (!tag) return null;
  return (
    <section
      aria-label="Release notes"
      class="sp-notes sp-dark"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <div class="sp-container sp-notes__inner">
        <div key={index} class={`sp-slide${moved ? " sp-slide--enter" : ""}`}>
          <p class="sp-slide__tag sp-mono">{tag.name}</p>
          <h3 class="sp-slide__headline">
            <span class="sp-slide__mark" aria-hidden="true">
              //
            </span>{" "}
            {tag.message === "" ? tag.name : tag.message}
          </h3>
        </div>
        <div class="sp-notes__controls">
          <p class="sp-notes__counter sp-mono">{`${index + 1} / ${count}`}</p>
          <button type="button" class="sp-round" aria-label="Previous release" onClick={() => step(-1)}>
            <Icon name="arrow-left" size={20} />
          </button>
          <button type="button" class="sp-round" aria-label="Next release" onClick={() => step(1)}>
            <Icon name="arrow-right" size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
