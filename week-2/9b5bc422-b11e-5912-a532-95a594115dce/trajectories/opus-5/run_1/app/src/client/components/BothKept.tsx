import { bothKept as copy, announce as say } from '../../domain/copy.ts';
import { cellText } from '../../domain/materialise.ts';
import type { CellValue, MergeField } from '../../domain/types.ts';
import { bothKept, keepButtons } from '../store/actions.ts';
import { announce } from '../store/store.ts';

/** Both values stay until the person picks one. */
export function BothKept<T extends CellValue>(props: {
  entity: 'block' | 'document' | 'row' | 'note';
  entityId: string;
  field: string;
  values: MergeField<T>;
  sentence: string;
  afterChoice: () => void;
  valueText?: (value: T) => string;
}) {
  const ordered = keepButtons(props.values);
  return (
    <div role="group" aria-label={copy.marker} className="both-kept">
      <p>{props.sentence}</p>
      {ordered.map((head) => (
        <button
          key={head.opId}
          type="button"
          className="button"
          onClick={() => {
            void bothKept
              .keep(
                props.entity,
                props.entityId,
                props.field,
                head.value,
                props.values.values.map((value) => value.opId),
              )
              .then(() => {
                announce(say.bothKeptResolved);
                props.afterChoice();
              });
          }}
        >
          {`Keep ${props.valueText ? props.valueText(head.value) : cellText(head.value)}`}
        </button>
      ))}
    </div>
  );
}
