// The page frame: instance status strip, sticky header, the page (<main>), footer, then the single announcements status and
// notifications region (outside <main>). /sign-in and /sign-up get the bare header and footer.
import type { ComponentChildren } from "preact";
import { Announcer } from "../announce.tsx";
import { useRoute } from "../router.ts";
import { Footer } from "./footer.tsx";
import { Header } from "./header.tsx";
import { StatusStrip } from "./strip.tsx";

const AUTH_PAGES = new Set(["/sign-in", "/sign-up"]);

export function Shell({ children }: { children: ComponentChildren }) {
  const route = useRoute();
  const signedOut = AUTH_PAGES.has(route.pattern);
  return (
    <div class={signedOut ? "sp-shell sp-shell--auth" : "sp-shell"}>
      <a
        href="#main"
        class="sp-skip"
        onClick={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <StatusStrip />
      <Header signedOut={signedOut} />
      {children}
      <Footer signedOut={signedOut} />
      <Announcer />
    </div>
  );
}
