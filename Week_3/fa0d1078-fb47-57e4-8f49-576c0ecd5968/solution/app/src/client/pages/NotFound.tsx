import type { JSX } from "preact";

interface NotFoundProps {
  sentence?: string;
}

export function NotFound({ sentence = "This page isn't in the collection." }: NotFoundProps): JSX.Element {
  return (
    <section class="voice-page">
      <h1 class="voice">{sentence}</h1>
    </section>
  );
}

interface VoiceProps {
  sentence: string;
}

/** A page that has only one sentence to say: waiting, failed or empty. */
export function Voice({ sentence }: VoiceProps): JSX.Element {
  return <p class="voice">{sentence}</p>;
}
