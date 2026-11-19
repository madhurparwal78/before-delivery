import { codePoints } from "../../shared/text";

/** `<used> / <max>` in code points, or `<n> over the limit`. */
export function Counter({ value, max }: { value: string; max: number }) {
  const used = codePoints(value);
  return <span className={`counter${used > max ? " counter--over" : ""}`}>{used > max ? `${used - max} over the limit` : `${used} / ${max}`}</span>;
}
