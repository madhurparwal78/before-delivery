// Page scaffolding.
//   <Page title band? project? live? pageKeys? class?>   <Main> (or <LiveMain> with `live`) holding the level 1 heading and the
//       children. The heading is focusable (tabIndex -1) so a navigation can land on it; pass `headingRef` to focus it.
//   useTitle(text)                                        document.title = `<text> · Spurline`
import type { ComponentChildren, Ref } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { LiveMain, Main } from "../shell/main.tsx";

export function useTitle(text: string): void {
  useLayoutEffect(() => {
    document.title = `${text} · Spurline`;
  }, [text]);
}

interface PageProps {
  title: string;
  band?: boolean;
  project?: string | number;
  live?: boolean;
  pageKeys?: readonly string[];
  class?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ComponentChildren;
}

export function Page({ title, band, project, live, pageKeys, class: className, headingRef, children }: PageProps) {
  useTitle(title);
  const heading = (
    <div class="sp-container">
      <h1 ref={headingRef} tabIndex={-1} class="sp-page-title">
        {title}
      </h1>
      {children}
    </div>
  );
  if (live && project !== undefined) {
    return (
      <LiveMain band={band} project={project} pageKeys={pageKeys} class={className}>
        {heading}
      </LiveMain>
    );
  }
  return (
    <Main band={band} project={project} pageKeys={pageKeys} class={className}>
      {heading}
    </Main>
  );
}
