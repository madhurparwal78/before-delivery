import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "../router";
import { useExit } from "./exit";

const PHONE = "(max-width: 767px)";

/** The two panes. Below 768 px one shows at a time: `detailFirst` says which, until `button "Back"`
 * or an opened item asks for the other through the history state. Moving between them places focus:
 * on the sheet's title going in, on the element that opened it coming back. */
export function Panes(props: { list: ReactNode; detail: ReactNode; detailFirst: boolean; detailKey: string }): JSX.Element {
  const location = useLocation();
  const asked = (location.state as { pane?: "list" | "detail" } | null)?.pane;
  const pane = asked ?? (props.detailFirst ? "detail" : "list");
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(pane);

  useEffect(() => {
    const node = listRef.current;
    const track = (event: FocusEvent): void => {
      opener.current = event.target as HTMLElement;
    };
    node?.addEventListener("focusin", track);
    return () => node?.removeEventListener("focusin", track);
  }, []);

  useLayoutEffect(() => {
    if (shown.current === pane) return;
    shown.current = pane;
    if (!window.matchMedia(PHONE).matches) return;
    if (pane === "list") {
      opener.current?.focus();
      return;
    }
    const sheet = detailRef.current;
    const focusTitle = (): boolean => {
      const title = sheet?.querySelector<HTMLElement>("h1");
      if (!title) return false;
      title.tabIndex = -1;
      title.focus();
      return true;
    };
    if (!sheet || focusTitle()) return;
    const waiting = new MutationObserver(() => {
      if (focusTitle()) waiting.disconnect();
    });
    waiting.observe(sheet, { childList: true, subtree: true });
    return () => waiting.disconnect();
  }, [pane]);

  return (
    <div className="panes" data-show={pane}>
      <section role="region" aria-label="List" className="pane list-pane" ref={listRef}>
        {props.list}
      </section>
      <section role="region" aria-label="Detail" className="pane detail-pane" ref={detailRef}>
        <DetailSheet key={props.detailKey}>{props.detail}</DetailSheet>
      </section>
    </div>
  );
}

function DetailSheet(props: { children: ReactNode }): JSX.Element {
  const ref = useExit<HTMLDivElement>("sheet");
  return (
    <div className="sheet-enter" ref={ref}>
      {props.children}
    </div>
  );
}
