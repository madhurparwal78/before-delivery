/** The product tour's "Show transcript" button: reveals the captions as page text. */
export function initTranscript(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-transcript-toggle]");
  const transcript = document.getElementById(button?.getAttribute("aria-controls") ?? "");
  if (!button || !transcript) return;
  button.addEventListener("click", () => {
    transcript.hidden = !transcript.hidden;
    button.setAttribute("aria-expanded", String(!transcript.hidden));
  });
}
