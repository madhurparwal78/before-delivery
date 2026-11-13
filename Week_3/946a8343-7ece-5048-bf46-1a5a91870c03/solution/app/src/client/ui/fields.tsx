// Form fields. Every field renders label, optional description, the control and an optional error, wired with
// aria-describedby (description id, then error id) and aria-invalid. The control id is `field-<name>` (fieldId(name)) unless
// `id` is given, so an <ErrorSummary> can link to it.
//   <TextField label name value onInput type? description? error? innerRef? ...input attributes>
//   <TextArea label name rows? ...>
//   <Select label name options? ...>         native <select>; pass `options` or <option> children
//   <Checkbox label name checked onChange description? error?>
//   fieldId(name)
import type { ComponentChildren, JSX, Ref } from "preact";
import { useId } from "preact/hooks";
import { Icon } from "./icons.tsx";

export function fieldId(name: string): string {
  return `field-${name}`;
}

interface FieldShell {
  label: string;
  name: string;
  id?: string;
  description?: ComponentChildren;
  error?: string | null;
  hideLabel?: boolean;
  class?: string;
}

function useIds(props: FieldShell) {
  const fallback = useId();
  const id = props.id ?? (props.name ? fieldId(props.name) : `field-${fallback}`);
  const descriptionId = props.description ? `${id}-description` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return { id, descriptionId, errorId, describedBy };
}

function Shell(props: FieldShell & { ids: ReturnType<typeof useIds>; children: ComponentChildren }) {
  const { ids } = props;
  return (
    <div class={`sp-field${props.error ? " sp-field--invalid" : ""}${props.class ? ` ${props.class}` : ""}`}>
      <label for={ids.id} class={`sp-field__label${props.hideLabel ? " sp-visually-hidden" : ""}`}>
        {props.label}
      </label>
      {props.description ? (
        <p id={ids.descriptionId} class="sp-field__description">
          {props.description}
        </p>
      ) : null}
      {props.children}
      {props.error ? (
        <p id={ids.errorId} class="sp-field__error">
          <Icon name="alert" size={16} />
          <span>{props.error}</span>
        </p>
      ) : null}
    </div>
  );
}

type Omitted = "label" | "name" | "id" | "ref" | "class";

type TextFieldProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, Omitted> & FieldShell & { innerRef?: Ref<HTMLInputElement> };

export function TextField(props: TextFieldProps) {
  const { label: _label, description: _description, error, hideLabel: _hideLabel, class: _class, innerRef, name, id: _id, ...rest } = props;
  const ids = useIds(props);
  return (
    <Shell {...props} ids={ids}>
      <input
        type="text"
        {...rest}
        ref={innerRef}
        id={ids.id}
        name={name}
        class="sp-input"
        aria-describedby={ids.describedBy}
        aria-invalid={error ? "true" : undefined}
      />
    </Shell>
  );
}

type TextAreaProps = Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, Omitted> & FieldShell & { innerRef?: Ref<HTMLTextAreaElement>; rows?: number };

export function TextArea(props: TextAreaProps) {
  const { label: _label, description: _description, error, hideLabel: _hideLabel, class: _class, innerRef, name, id: _id, ...rest } = props;
  const ids = useIds(props);
  return (
    <Shell {...props} ids={ids}>
      <textarea
        rows={4}
        {...rest}
        ref={innerRef}
        id={ids.id}
        name={name}
        class="sp-input sp-input--area"
        aria-describedby={ids.describedBy}
        aria-invalid={error ? "true" : undefined}
      />
    </Shell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

type SelectProps = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, Omitted> &
  FieldShell & { innerRef?: Ref<HTMLSelectElement>; options?: readonly SelectOption[] };

export function Select(props: SelectProps) {
  const { label: _label, description: _description, error, hideLabel: _hideLabel, class: _class, innerRef, name, id: _id, options, children, ...rest } = props;
  const ids = useIds(props);
  return (
    <Shell {...props} ids={ids}>
      <div class="sp-select">
        <select {...rest} ref={innerRef} id={ids.id} name={name} class="sp-input" aria-describedby={ids.describedBy} aria-invalid={error ? "true" : undefined}>
          {options
            ? options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            : children}
        </select>
        <Icon name="chevron-down" size={20} class="sp-select__chevron" />
      </div>
    </Shell>
  );
}

type CheckboxProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, Omitted | "type"> & FieldShell & { innerRef?: Ref<HTMLInputElement> };

export function Checkbox(props: CheckboxProps) {
  const { label, description: _description, error, hideLabel: _hideLabel, class: _class, innerRef, name, id: _id, ...rest } = props;
  const ids = useIds(props);
  return (
    <div class={`sp-field sp-field--check${props.error ? " sp-field--invalid" : ""}${props.class ? ` ${props.class}` : ""}`}>
      <label class="sp-check" for={ids.id}>
        <input {...rest} ref={innerRef} type="checkbox" id={ids.id} name={name} class="sp-check__input" aria-describedby={ids.describedBy} aria-invalid={error ? "true" : undefined} />
        <span class="sp-check__label">{label}</span>
      </label>
      {props.description ? (
        <p id={ids.descriptionId} class="sp-field__description">
          {props.description}
        </p>
      ) : null}
      {props.error ? (
        <p id={ids.errorId} class="sp-field__error">
          <Icon name="alert" size={16} />
          <span>{props.error}</span>
        </p>
      ) : null}
    </div>
  );
}
