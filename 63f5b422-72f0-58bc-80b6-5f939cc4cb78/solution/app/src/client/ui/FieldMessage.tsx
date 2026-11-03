import { Icon } from "./icons.js";

/** A field's own error, linked from the field by aria-describedby: ink text beside an outlined icon. */
export function FieldMessage({ id, children }: { id?: string; children: string }) {
  return (
    <p className="pl-field-message" id={id}>
      <Icon name="circle-alert" size={14} />
      <span>{children}</span>
    </p>
  );
}
