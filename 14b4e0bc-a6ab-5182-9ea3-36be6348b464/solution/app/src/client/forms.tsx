import type { Ref } from "preact";
import { afterRender } from "./lib.ts";
import { focusEl } from "./ui.tsx";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  error?: string;
  multiline?: boolean;
  type?: string;
  onInput(value: string): void;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
}

/** A labelled field whose 422 message is tied to it by aria-invalid and aria-describedby (DP-94). */
export function TextField(props: FieldProps) {
  const errorId = `${props.id}-error`;
  const shared = {
    id: props.id,
    value: props.value,
    "aria-invalid": props.error ? ("true" as const) : undefined,
    "aria-describedby": props.error ? errorId : undefined,
    onInput: (e: Event) => props.onInput((e.currentTarget as HTMLInputElement).value),
  };
  return (
    <div class="field">
      <label for={props.id} class="field-label">{props.label}</label>
      {props.multiline ? (
        <textarea {...shared} rows={4} ref={props.inputRef as Ref<HTMLTextAreaElement>} />
      ) : (
        <input {...shared} type={props.type ?? "text"} ref={props.inputRef as Ref<HTMLInputElement>} autocomplete="off" />
      )}
      <p id={errorId} class="field-error">{props.error ?? ""}</p>
    </div>
  );
}

export function firstMessage(fields: Record<string, string>, order: string[]): string | undefined {
  const key = order.find((f) => fields[f]);
  return key ? fields[key] : Object.values(fields)[0];
}

/** After a 422 paints, focus the first invalid field in dialog order. */
export async function focusFirstInvalid(fields: Record<string, string>, order: [string, string][]): Promise<void> {
  await afterRender();
  const first = order.find(([key]) => fields[key]);
  if (first) focusEl(document.getElementById(first[1]));
}
