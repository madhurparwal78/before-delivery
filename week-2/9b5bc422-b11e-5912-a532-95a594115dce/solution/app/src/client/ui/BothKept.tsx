import type { FieldValue, RecordKind } from "../../shared/sync.ts";
import { chooseVersion } from "../store/actions.ts";
import { showConfirmation } from "../store/announcer.ts";

export function BothKept({ kind, id, field, values, sentence, text, onChosen }: {
  kind: RecordKind;
  id: string;
  field: string;
  values: FieldValue[];
  sentence: string;
  text: (value: FieldValue) => string;
  onChosen: () => void;
}) {
  return (
    <div role="group" aria-label="Both kept" className="both-kept">
      <p>{sentence}</p>
      {values.map((value) => (
        <button
          key={text(value)}
          type="button"
          className="keep"
          onClick={() => {
            chooseVersion(kind, id, field, value);
            showConfirmation("Kept one version.");
            onChosen();
          }}
        >
          Keep {text(value)}
        </button>
      ))}
    </div>
  );
}
