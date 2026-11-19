export type Ring = [number, number][];

type FeatureCollection = {
  features: { geometry: { coordinates: Ring[] } }[];
};

let cached: Promise<Ring[]> | null = null;

/** The bundled coastline geometry, served from the app's own origin. */
export function loadCoastline(): Promise<Ring[]> {
  if (!cached) {
    cached = fetch('/coastline.json')
      .then((response) => response.json() as Promise<FeatureCollection>)
      .then((collection) =>
        collection.features.map((feature) => feature.geometry.coordinates[0] as Ring),
      );
  }
  return cached;
}

export type Frame = {
  width: number;
  height: number;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
};

export function projectRing(ring: Ring, frame: Frame): [number, number][] {
  const spanLon = frame.maxLon - frame.minLon;
  const spanLat = frame.maxLat - frame.minLat;
  return ring.map(([lon, lat]) => [
    ((lon - frame.minLon) / spanLon) * frame.width,
    frame.height - ((lat - frame.minLat) / spanLat) * frame.height,
  ]);
}
