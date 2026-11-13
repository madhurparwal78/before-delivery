// Cards.
//   <Kicker>TEXT</Kicker>                              mono bracket kicker `[ TEXT ]`
//   <Card kicker? title explanation? level? tone? id?> white bordered square card: bracket kicker, bold title, large muted
//       explanation, then the controls (children). Renders <section aria-labelledby> so it is the region named by its title.
//       `tone="dark"` uses the surface step for cards on dark.
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { Heading } from "./heading.tsx";

export function Kicker({ children, class: className }: { children: ComponentChildren; class?: string }) {
  return <span class={`sp-kicker${className ? ` ${className}` : ""}`}>[ {children} ]</span>;
}

interface CardProps {
  title: string;
  kicker?: string;
  explanation?: ComponentChildren;
  level?: 2 | 3 | 4;
  tone?: "light" | "dark";
  id?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Card({ title, kicker, explanation, level = 2, tone = "light", id, class: className, children }: CardProps) {
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} class={`sp-card sp-card--${tone} ${tone === "light" ? "sp-light" : "sp-dark"}${className ? ` ${className}` : ""}`}>
      {kicker ? <Kicker class="sp-card__kicker">{kicker}</Kicker> : null}
      <Heading level={level} id={titleId} class="sp-card__title">
        {title}
      </Heading>
      {explanation ? <p class="sp-card__explanation">{explanation}</p> : null}
      {children}
    </section>
  );
}
