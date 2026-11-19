const ZERO_WIDTH = "​";
let flip = false;

/** Writes the one polite region; a repeated message still changes its content, so it is announced twice. */
export function announce(message: string): void {
  const region = document.getElementById("announcements") as HTMLElement;
  flip = !flip;
  region.textContent = flip ? message : `${message}${ZERO_WIDTH}`;
}
