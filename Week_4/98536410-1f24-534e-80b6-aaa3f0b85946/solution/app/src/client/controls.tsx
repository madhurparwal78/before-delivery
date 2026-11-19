import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";

interface PausedButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-describedby" | "aria-disabled"> {
  paused: boolean;
  /** An answer is awaited: the control keeps its name, is aria-disabled and ignores presses. */
  busy?: boolean;
  /** What the control is described by while paused (its own pause sentence). */
  pauseCopy: string;
  /** Extra description, such as the pending copy while an answer is awaited. */
  describedBy?: string;
  onPress: () => void;
  onPaused: (copy: string) => void;
  children: ReactNode;
}

/** A control that needs object storage: it stays in place and reachable, says why it is paused, and does nothing when pressed. */
export function PausedButton({ paused, busy = false, pauseCopy, describedBy, onPress, onPaused, children, ...rest }: PausedButtonProps) {
  const id = useId();
  const description = paused ? pauseCopy : describedBy ?? "";
  return (
    <>
      <button
        {...rest} type="button" aria-disabled={paused || busy || undefined} aria-describedby={description ? id : undefined}
        onClick={() => (paused ? onPaused(pauseCopy) : onPress())}
      >
        {children}
      </button>
      <span id={id} className="visually-hidden">{description}</span>
    </>
  );
}

/** A named live region; the text changes only when the screen puts a new message in it. */
export function Status({ label, text, className }: { label: string; text: string; className?: string }) {
  return <p role="status" aria-label={label} className={className ?? "status-line"}>{text}</p>;
}
