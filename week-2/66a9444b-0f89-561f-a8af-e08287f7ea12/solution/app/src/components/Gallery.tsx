// The gallery: published entries in masked frames, panned sideways while the section is pinned.
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { drawFrame } from "../gallery/frameArt.ts";
import type { Entry } from "../types.ts";

function Frame({ entry, index }: { entry: Entry; index: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = entry.images.find((i) => i.display_url);
  useEffect(() => {
    if (!image && canvas.current) drawFrame(canvas.current, entry.id, entry.discipline);
  }, [entry.id, entry.discipline, image]);
  return (
    <figure className={`frame frame--cut${index % 3}`} data-frame>
      <div className="frame__art">
        {image ? <img src={image.display_url!} alt="" width={image.width} height={image.height} loading="lazy" />
          : <canvas ref={canvas} width={360} height={450} aria-hidden="true" />}
      </div>
      <figcaption className="frame__caption">{entry.title} — {entry.artist_name}</figcaption>
    </figure>
  );
}

export function Gallery() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    void api.get<{ entries: Entry[] }>("/api/gallery").then((r) => setEntries(r.ok ? r.data.entries : []));
  }, []);
  return (
    <section className="section section--gallery" data-ground="gallery" data-gallery aria-labelledby="gallery-head" id="gallery">
      <div className="gallery__pin">
        <h2 id="gallery-head" className="display section__head gallery__head" data-fit data-kinetic>Gallery</h2>
        <div className="gallery__track" data-gallery-track>
          {entries?.map((e, i) => <Frame key={e.id} entry={e} index={i} />)}
        </div>
      </div>
    </section>
  );
}
