import type { ReactNode } from "react";
import { displayJson } from "../../shared/display.js";
import type { JsonValue } from "../../shared/json.js";

/** Pretty JSON for the black code panes: numbers follow the display rule, keys are white, structure shows by weight. */

const KEY_LINE = /^(\s*)("(?:[^"\\]|\\.)*")(:)(.*)$/;

export function JsonCode({ value }: { value: JsonValue }): ReactNode {
  const lines = displayJson(value, 2).split("\n");
  return (
    <code className="json-code">
      {lines.map((line, index) => {
        const key = KEY_LINE.exec(line);
        return (
          <span className="json-line" key={index}>
            {key ? (
              <>
                {key[1]}
                <span className="json-key">{key[2]}</span>
                {key[3]}
                {key[4]}
              </>
            ) : (
              line
            )}
            {"\n"}
          </span>
        );
      })}
    </code>
  );
}
