const FACES = ['400 1em "Dela Gothic One"', '400 1em "DM Sans"', '600 1em "DM Sans"', '700 1em "DM Sans"'];
const GIVE_UP_MS = 2500;

/** Waits for the bundled faces before the page is built, so no heading re-wraps when a font arrives late. */
export async function fontsReady(): Promise<void> {
  const loaded = Promise.all(FACES.map((face) => document.fonts.load(face))).then(() => undefined, () => undefined);
  await Promise.race([loaded, new Promise<void>((resolve) => setTimeout(resolve, GIVE_UP_MS))]);
}
