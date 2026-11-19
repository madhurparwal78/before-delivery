import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { SESSION_ENDED } from "../api";
import { keepDraft, signInAgainHref, type Draft } from "../session";
import type { Me } from "../shell";

/** A screen's announcements, and what it does when a write is refused because the session ended. */
export function useAnnouncer(me: Me | null) {
  const [text, setText] = useState("");
  const [signInAgain, setSignInAgain] = useState<string | null>(null);
  const focusLink = useRef(false);
  useLayoutEffect(() => {
    if (focusLink.current && signInAgain) {
      focusLink.current = false;
      document.getElementById("sign-in-again")?.focus();
    }
  });
  return {
    text,
    signInAgain,
    announce: (next: string) => setText(next),
    /** Shows the session-ended copy and the Sign in again link, keeps the draft, and moves focus to the link. */
    sessionEnded: (draft: Omit<Draft, "path" | "userId">) => {
      if (me) keepDraft({ ...draft, path: window.location.pathname, userId: me.user.id });
      setText(SESSION_ENDED);
      focusLink.current = true;
      setSignInAgain(signInAgainHref(window.location.pathname));
    },
  };
}
