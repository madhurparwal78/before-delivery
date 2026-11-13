import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { prefersReducedMotion } from "./state/story.js";

/** Shared interface primitives: every control carries its graded motion hook. */

type Variant = "primary" | "secondary" | "ghost";

type Motion = "press" | "focus" | "shake" | "count" | "step" | "payment-state" | "receipt" | "row" | "route";

const rise = (from: string): Keyframe[] => [{ transform: from, opacity: 0 }, { transform: "none", opacity: 1 }];
/** Slides without fading: what arrives with a page's text never shows that text below contrast. */
const slide = (from: string): Keyframe[] => [{ transform: from }, { transform: "none" }];

const KEYFRAMES: Record<Motion, Keyframe[]> = {
  press: [{ transform: "scale(1)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }],
  focus: [{ boxShadow: "0 0 0 0 transparent", outlineColor: "transparent" }, {}],
  shake: ["0", "-4px", "4px", "-4px", "4px", "-4px", "4px", "0"].map((x) => ({ transform: `translateX(${x})` })),
  count: rise("translateY(45%)"),
  step: rise("translateX(28px)"),
  "payment-state": [{ opacity: 0 }, { opacity: 1 }],
  receipt: rise("scaleY(0.6)"),
  row: slide("translateY(8px)"),
  route: slide("translateY(18px)"),
};

const ON_MOUNT: readonly string[] = ["count", "step", "payment-state", "receipt", "row", "route"];

const tokenMs = (tokens: CSSStyleDeclaration, name: string): number => {
  const token = tokens.getPropertyValue(name).trim();
  return parseFloat(token) * (token.endsWith("ms") ? 1 : 1000);
};

/** Runs a motion at once, through Web Animations, so a slow frame, a re-render or an unmount cannot lose it. */
export const playMotion = (element: HTMLElement | null, motion: Motion): void => {
  if (!element) return;
  const tokens = getComputedStyle(document.documentElement);
  const still = prefersReducedMotion();
  const index = motion === "row" ? parseFloat(element.style.getPropertyValue("--row-index")) || 0 : 0;
  element.animate(KEYFRAMES[motion], {
    duration: still ? 0 : tokenMs(tokens, `--d-${motion}`),
    delay: still ? 0 : index * tokenMs(tokens, "--d-row-stagger"),
    easing: tokens.getPropertyValue("--ease"),
    fill: "backwards",
  });
};

const playOnMount = (node: Node): void => {
  if (!(node instanceof HTMLElement)) return;
  for (const element of [node, ...node.querySelectorAll<HTMLElement>("[data-motion]")]) {
    const motion = element.dataset["motion"];
    if (motion && ON_MOUNT.includes(motion)) playMotion(element, motion as Motion);
  }
};

/** Starts the motions that belong to an element's arrival and to an input's focus. */
export const watchMotions = (): void => {
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(playOnMount);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset["motion"] === "focus") playMotion(event.target, "focus");
  });
};

export const Button = ({ variant = "secondary", onClick, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) => {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      data-motion="press"
      className={`btn btn--${variant} ${className}`}
      onClick={(event) => {
        playMotion(ref.current, "press");
        onClick?.(event);
      }}
    />
  );
};

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
}

/** A labelled text input; the label is the accessible name, the error sits beside the field. */
export const TextField = ({ label, error, id, className = "", ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) => {
  const fieldId = id ?? `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input {...rest} id={fieldId} data-motion="focus" className={className} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fieldId}-error` : undefined} />
      <span id={`${fieldId}-error`} className="error">{error ?? ""}</span>
    </div>
  );
};

export const TextArea = ({ label, error, id, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const fieldId = id ?? `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <textarea {...rest} id={fieldId} data-motion="focus" aria-invalid={error ? true : undefined} aria-describedby={error ? `${fieldId}-error` : undefined} />
      <span id={`${fieldId}-error`} className="error">{error ?? ""}</span>
    </div>
  );
};

/** A live region named for assistive technology; its text is exactly the published copy. */
export const Status = ({ label, children, className }: { label: string; children?: ReactNode; className?: string }) => (
  <div role="status" aria-label={label} className={className}>{children}</div>
);

export const Alert = ({ label, children, className }: { label: string; children?: ReactNode; className?: string }) => (
  <div role="alert" aria-label={label} className={className}>{children}</div>
);

/** A ruled ink-on-snow sheet that slides over the dimmed scene. */
export const Sheet = ({ children, wide = false }: { children: ReactNode; wide?: boolean }) => (
  <main className={`sheet${wide ? " sheet--wide" : ""}`} data-motion="route">{children}</main>
);
