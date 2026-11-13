/** An intermission slide: one big display line and one italic sentence. */
export function Slide({ line, sentence, tone = "ground" }: { line: string; sentence: string; tone?: "ground" | "charcoal" }) {
  return (
    <div class={`slide slide-${tone}`}>
      <p class="slide-line">{line}</p>
      <p class="slide-sentence">{sentence}</p>
    </div>
  );
}
