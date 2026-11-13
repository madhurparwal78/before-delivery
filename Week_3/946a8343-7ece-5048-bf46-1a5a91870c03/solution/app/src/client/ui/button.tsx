// Buttons.
//   <Button variant? pending? innerRef? ...button attributes>   variants primary (default), secondary, ghost, danger. Square,
//       48 px, flat. `pending` sets aria-busy="true" and disabled and keeps the label (use with useAction().pending).
//   <LinkButton href variant? ...anchor attributes>              an in-app link drawn as a button (same variants).
import type { ComponentChildren, JSX, Ref } from "preact";
import { A, type AnchorProps } from "../router.ts";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "ref"> & {
  variant?: ButtonVariant;
  pending?: boolean;
  type?: "button" | "submit" | "reset";
  innerRef?: Ref<HTMLButtonElement>;
  children?: ComponentChildren;
};

export function Button({ variant = "primary", pending = false, class: className, innerRef, type = "button", disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      ref={innerRef}
      class={`sp-btn sp-btn--${variant}${className ? ` ${className}` : ""}`}
      disabled={pending || disabled === true}
      aria-busy={pending ? "true" : undefined}
    />
  );
}

type LinkButtonProps = AnchorProps & { variant?: ButtonVariant };

export function LinkButton({ variant = "primary", class: className, ...rest }: LinkButtonProps) {
  return <A {...rest} class={`sp-btn sp-btn--${variant}${className ? ` ${className}` : ""}`} />;
}
