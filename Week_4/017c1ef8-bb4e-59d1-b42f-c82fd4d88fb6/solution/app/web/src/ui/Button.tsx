import { forwardRef, type ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

const join = (...names: Array<string | undefined>): string => names.filter(Boolean).join(' ');

/** A pink field with navy text. While its action is pending, pass `disabled`: the text stays the same. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={join('button', className)} {...rest} />;
});

/** Underlined pink text on navy, for the quieter action. */
export const LinkButton = forwardRef<HTMLButtonElement, ButtonProps>(function LinkButton({ className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={join('link-button', className)} {...rest} />;
});
