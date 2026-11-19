// The bundled coastline geometry (Natural Earth, public domain), drawn as flat land shapes.
import { useEffect, useState } from "react";

interface Coastline {
  rings: [number, number][][];
}

let loaded: Promise<Coastline> | null = null;

function loadCoastline(): Promise<Coastline> {
  loaded ??= fetch("/coastline.json").then((response) => response.json() as Promise<Coastline>);
  return loaded;
}

export function useCoastline(): Coastline | null {
  const [coastline, setCoastline] = useState<Coastline | null>(null);
  useEffect(() => {
    void loadCoastline().then(setCoastline);
  }, []);
  return coastline;
}

/** Path data in longitude/latitude units; the caller scales it to the screen with an SVG transform. */
export function landPath(coastline: Coastline): string {
  return coastline.rings.map((ring) => `M${ring.map(([lon, lat]) => `${lon} ${-lat}`).join("L")}Z`).join("");
}
