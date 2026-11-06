export type Density = "List" | "Card" | "Grid";
export type ColourScheme = "Light" | "Dark" | "System";
export type DocumentFilter = { search: string; folder: string; tag: string; starred: boolean };
export type SavedFilter = DocumentFilter & { name: string };
export type Camera = { zoom: number; panX: number; panY: number };

const read = <T,>(key: string, fallback: T): T => {
  const stored = localStorage.getItem(`oddment.${key}`);
  return stored === null ? fallback : (JSON.parse(stored) as T);
};
const write = (key: string, value: unknown): void => localStorage.setItem(`oddment.${key}`, JSON.stringify(value));

export const NO_FILTER: DocumentFilter = { search: "", folder: "", tag: "", starred: false };
const STARRED: SavedFilter = { ...NO_FILTER, starred: true, name: "Starred" };

export const readDensity = (): Density => read<Density>("density", "List");
export const writeDensity = (density: Density): void => write("density", density);
export const readScheme = (): ColourScheme => read<ColourScheme>("scheme", "System");
export const writeScheme = (scheme: ColourScheme): void => write("scheme", scheme);
export const readSavedFilters = (): SavedFilter[] => read<SavedFilter[]>("filters", [STARRED]);
export const writeSavedFilters = (filters: SavedFilter[]): void => write("filters", filters);

const START_CAMERA: Camera = { zoom: 1, panX: 40, panY: 40 };
export const readCamera = (documentId: string): Camera => read<Camera>(`camera.${documentId}`, START_CAMERA);
export const writeCamera = (documentId: string, camera: Camera): void => write(`camera.${documentId}`, camera);
