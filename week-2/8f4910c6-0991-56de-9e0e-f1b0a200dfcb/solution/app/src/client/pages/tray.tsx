// The cast tray (/tray): reorder and remove at once, focus stays on the moved item's same button.

import { useLayoutEffect, useRef, useState } from "react";
import { definePage, Link, navigate } from "../router.js";
import { Heading } from "../ui/heading.js";
import { Portrait } from "../ui/portrait.js";
import { Button } from "../ui/button.js";
import { moveInTray, removeFromTray, useTray } from "../tray.js";

type Target = { slug: string; button: "Up" | "Down" | "Remove" } | { start: true } | null;

function TrayPage() {
  const tray = useTray();
  const [focusTarget, setFocusTarget] = useState<Target>(null);
  const list = useRef<HTMLOListElement>(null);
  const start = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!focusTarget) return;
    if ("start" in focusTarget) start.current?.focus();
    else {
      list.current?.querySelector<HTMLButtonElement>(
        `[data-slug="${CSS.escape(focusTarget.slug)}"] [data-action="${focusTarget.button}"]`)?.focus();
    }
    setFocusTarget(null);
  }, [focusTarget, tray]);

  const remove = (index: number) => {
    const next = tray[index + 1] ?? tray[index - 1];
    removeFromTray(tray[index].slug);
    setFocusTarget(tray.length > 1 && next ? { slug: next.slug, button: "Remove" } : { start: true });
  };

  return (
    <>
      <Heading lines={["Your tray"]} />
      <p className="lede">The talent you would like to cast, in your order of preference. Up to 12 fit in the tray.</p>
      {tray.length ? (
        <ol ref={list} aria-label="Tray" className="tray-list">
          {tray.map((item, index) => (
            <li key={item.slug} aria-label={item.displayName} data-slug={item.slug} className="tray-item">
              <div className="tray-thumb">
                <Portrait src={item.photoUrl} alt="" name={item.displayName} />
              </div>
              <div className="tray-name">
                <span className="eyebrow num">{index + 1}</span>
                <Link href={`/talent/${item.slug}`}>{item.displayName}</Link>
              </div>
              <div className="btn-row">
                <Button variant="quiet" data-action="Up" aria-disabled={index === 0 ? true : undefined}
                  onClick={() => {
                    if (index === 0) return;
                    moveInTray(item.slug, -1);
                    setFocusTarget({ slug: item.slug, button: "Up" });
                  }}>Up</Button>
                <Button variant="quiet" data-action="Down" aria-disabled={index === tray.length - 1 ? true : undefined}
                  onClick={() => {
                    if (index === tray.length - 1) return;
                    moveInTray(item.slug, 1);
                    setFocusTarget({ slug: item.slug, button: "Down" });
                  }}>Down</Button>
                <Button variant="quiet" data-action="Remove" onClick={() => remove(index)}>Remove</Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <section className="panel" aria-label="Empty tray">
          <h2>Your tray is empty</h2>
          <p className="muted">Add talent from a <Link href="/boards">board</Link> or a profile to start a cast request.</p>
        </section>
      )}
      <div className="sticky-bar">
        <span className="muted num">{tray.length === 1 ? "1 talent" : `${tray.length} talent`}</span>
        <Button ref={start} aria-disabled={tray.length === 0 ? true : undefined}
          onClick={() => tray.length && navigate("/cast-request?step=1")}>Start cast request</Button>
      </div>
    </>
  );
}

definePage({ pattern: "/tray", kind: "public", render: () => <TrayPage /> });
