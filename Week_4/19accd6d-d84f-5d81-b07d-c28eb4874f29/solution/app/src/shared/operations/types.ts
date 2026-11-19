export type ArgValue = string | number | boolean;
export type StepArgs = Record<string, ArgValue>;

export const FAMILIES = ["Encoding", "Text", "Data formats", "Checksums", "Compression", "Flow"] as const;
export type Family = (typeof FAMILIES)[number];

interface ArgBase {
  /** The published label, which is also the field name in the step card. */
  label: string;
  /** The label in lower camelCase, which is the key in a step's `args`. */
  key: string;
}

export interface OptionArg extends ArgBase {
  kind: "option";
  options: readonly string[];
  default: string;
}

export interface ToggleArg extends ArgBase {
  kind: "toggle";
  default: boolean;
}

export interface IntegerArg extends ArgBase {
  kind: "integer";
  min: number;
  max: number;
  default: number;
}

export interface TextArg extends ArgBase {
  kind: "text";
  default: string;
}

export interface FlagsArg extends ArgBase {
  kind: "flags";
  default: string;
}

export type ArgSpec = OptionArg | ToggleArg | IntegerArg | TextArg | FlagsArg;

export interface Step {
  op: string;
  args: StepArgs;
  disabled: boolean;
  breakpoint: boolean;
}

/** A failure of one operation; the message is the catalogue's published error text. */
export class OperationError extends Error {}
