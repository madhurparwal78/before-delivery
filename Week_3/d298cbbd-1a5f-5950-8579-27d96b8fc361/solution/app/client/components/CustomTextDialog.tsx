import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { CUSTOM_MAX_CHARACTERS, CUSTOM_MAX_WORDS, countCustomText, customOverLimit } from "../../shared/texts";
import { Dialog } from "./Dialog";

interface Props {
  readonly initialText: string;
  readonly onUse: (text: string) => void;
  readonly onCancel: () => void;
}

export function CustomTextDialog({ initialText, onUse, onCancel }: Props): JSX.Element {
  const [text, setText] = useState(initialText);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const count = countCustomText(text);
  const over = customOverLimit(count);
  const usable = !over && count.characters > 0;

  useLayoutEffect(() => boxRef.current?.focus(), []);

  function use(): void {
    if (usable) onUse(count.text);
  }

  return (
    <Dialog label="Custom text" onCancel={onCancel} class="dialog custom-text">
      <h2 class="dialog-title">Custom text</h2>
      <textarea
        ref={boxRef}
        class="custom-box"
        aria-label="Custom text"
        aria-describedby="custom-count"
        spellcheck={false}
        rows={7}
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            use();
          }
        }}
      />
      <p id="custom-count" class={over ? "custom-count over" : "custom-count"}>
        {over
          ? `Custom text can have at most ${CUSTOM_MAX_CHARACTERS} characters and ${CUSTOM_MAX_WORDS} words.`
          : `${count.characters} of ${CUSTOM_MAX_CHARACTERS} characters, ${count.words} of ${CUSTOM_MAX_WORDS} words`}
      </p>
      <div class="dialog-actions">
        <button type="button" class="button" disabled={!usable} onClick={use}>Use text</button>
        <button type="button" class="button ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Dialog>
  );
}
