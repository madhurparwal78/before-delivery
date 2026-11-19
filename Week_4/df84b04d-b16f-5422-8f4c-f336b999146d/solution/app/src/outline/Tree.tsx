import {
  useLayoutEffect, useRef, useState, useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { PLACEHOLDER_TEXT } from "../../shared/copy";
import { bulletLabel } from "../../shared/text";
import type { Suggestion } from "../../shared/types";
import { get } from "../lib/api";
import { Link, navigate, reducedMotion } from "../lib/router";
import { IconCollapse } from "../lib/icons";
import { zoomInto, zoomOrigin } from "./actions";
import type { OutlineController } from "./controller";
import type { RowNode } from "./model";
import { RichText } from "./rich";

const SWIPE_MIN_PX = 48;
const SWIPE_SLACK_PX = 40;
const TAP_SLACK_PX = 10;
const FOLD_MS = 150;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

interface TokenMatch {
  start: number;
  marker: "#" | "@";
  prefix: string;
}

function tokenBefore(value: string, caret: number): TokenMatch | null {
  const found = /(?:^|\s)([#@])([\p{L}\p{N}_-]*)$/u.exec(value.slice(0, caret));
  if (found === null) return null;
  const marker = found[1] === "#" ? "#" : "@";
  return { start: caret - (found[2]?.length ?? 0) - 1, marker, prefix: found[2] ?? "" };
}

function singleLine(element: HTMLTextAreaElement): boolean {
  return element.scrollHeight <= parseFloat(getComputedStyle(element).lineHeight) * 1.5;
}

function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const fold = useRef<HTMLDivElement>(null);
  const expanding = useRef(false);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = fold.current;
    element?.getAnimations().forEach((animation) => animation.cancel());
    if (element !== null) element.style.overflow = "";
    if (open) {
      expanding.current = true;
      setMounted(true);
      return;
    }
    if (element === null || reducedMotion()) {
      setMounted(false);
      return;
    }
    element.style.overflow = "hidden";
    const height = element.getBoundingClientRect().height;
    const animation = element.animate([{ height: `${height}px`, opacity: 1 }, { height: "0px", opacity: 0 }], {
      duration: FOLD_MS, easing: EASE, fill: "forwards",
    });
    animation.onfinish = () => setMounted(false);
  }, [open]);

  useLayoutEffect(() => {
    const element = fold.current;
    if (!expanding.current || !mounted || element === null) return;
    expanding.current = false;
    if (reducedMotion()) return;
    element.animate(
      [{ clipPath: "inset(0 0 100% 0)", opacity: 0, transform: "translateY(-6px)" }, { clipPath: "inset(0 0 0 0)", opacity: 1, transform: "none" }],
      { duration: FOLD_MS, easing: EASE },
    );
  }, [mounted]);

  if (!mounted && !open) return null;
  return <div className="fold" ref={fold}>{children}</div>;
}

interface RowProps {
  node: RowNode;
  controller: OutlineController;
  focused: string | null;
  rootId: string | null;
  hasKids: boolean;
  children: ReactNode;
}

function RowView({ node, controller, focused, rootId, hasKids, children }: RowProps) {
  const { bullet } = node;
  const key = controller.textKey(bullet);
  const draft = useSyncExternalStore((listener) => controller.subscribeDraft(key, listener), () => controller.draftSnapshot(key));
  const text = draft ?? bullet.text;
  const isFocused = focused === node.key;
  const area = useRef<HTMLTextAreaElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const request = useSyncExternalStore(controller.subscribe, () => controller.state.focusRequest);
  const handled = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [suggest, setSuggest] = useState<{ items: Suggestion[]; index: number; token: TokenMatch } | null>(null);
  const suggestToken = useRef(0);
  const caretAfter = useRef<number | null>(null);
  const label = bulletLabel(text);
  const name = bullet.placeholder ? PLACEHOLDER_TEXT : text.trim() === "" ? "Untitled" : text;

  useLayoutEffect(() => {
    if (request === null || request.key !== node.key || request.nonce === handled.current) return;
    handled.current = request.nonce;
    const element = area.current;
    if (element === null) return;
    element.focus({ preventScroll: false });
    const at = request.caret === "start" ? 0 : element.value.length;
    element.setSelectionRange(at, at);
    controller.consumeFocus(request.nonce);
  }, [request, node.key, controller]);

  useLayoutEffect(() => {
    if (caretAfter.current !== null && area.current !== null) {
      area.current.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  });

  const openSuggestions = async (value: string, caret: number) => {
    const token = tokenBefore(value, caret);
    const ticket = ++suggestToken.current;
    if (token === null) {
      setSuggest(null);
      return;
    }
    const kind = token.marker === "#" ? "tag" : "mention";
    const root = rootId === null ? "" : `&root=${encodeURIComponent(rootId)}`;
    const found = await get<{ suggestions: Suggestion[] }>(`/api/suggest?kind=${kind}&prefix=${encodeURIComponent(token.prefix)}${root}`);
    if (ticket !== suggestToken.current) return;
    setSuggest(found.suggestions.length === 0 ? null : { items: found.suggestions, index: 0, token });
  };

  const insertSuggestion = (value: string) => {
    const element = area.current;
    if (element === null || suggest === null) return;
    const caret = element.selectionStart;
    const next = `${element.value.slice(0, suggest.token.start)}${value} ${element.value.slice(caret)}`;
    caretAfter.current = suggest.token.start + value.length + 1;
    controller.edit(bullet, next);
    suggestToken.current += 1;
    setSuggest(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const element = event.currentTarget;
    const mod = event.ctrlKey || event.metaKey;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    if (suggest !== null) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        stop();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + step + suggest.items.length) % suggest.items.length });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        stop();
        insertSuggestion(suggest.items[suggest.index]?.value ?? "");
        return;
      }
      if (event.key === "Escape") {
        stop();
        suggestToken.current += 1;
        setSuggest(null);
        return;
      }
    }
    if (event.altKey && event.key === "ArrowRight") {
      stop();
      zoomInto(controller, node.key, bullet.id);
    } else if (mod && event.shiftKey && event.key === "Backspace") {
      stop();
      controller.requestDelete(node.key);
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "m") {
      stop();
      controller.mirror(node.key);
    } else if (mod && event.key === "Enter") {
      stop();
      controller.toggleComplete(node.key);
    } else if (mod && event.key === " ") {
      stop();
      controller.toggleCollapse(node.key);
    } else if (mod && event.key === "ArrowUp") {
      stop();
      controller.structural(node.key, "up");
    } else if (mod && event.key === "ArrowDown") {
      stop();
      controller.structural(node.key, "down");
    } else if (event.key === "Tab") {
      stop();
      controller.structural(node.key, event.shiftKey ? "outdent" : "indent");
    } else if (event.key === "Enter" && !event.shiftKey) {
      stop();
      const start = element.selectionStart;
      if (start === 0 && element.value !== "") controller.addAbove(node.key);
      else if (start >= element.value.length && element.selectionEnd >= element.value.length) controller.addBelow(node.key);
      else controller.split(node.key, start);
    } else if (event.key === "Backspace" && element.value === "" && !bullet.placeholder) {
      stop();
      controller.backspaceEmpty(node.key);
    } else if (event.key === "ArrowUp" && !event.shiftKey && (element.selectionStart === 0 || singleLine(element))) {
      const above = controller.neighbour(node.key, -1);
      stop();
      if (above !== undefined) controller.requestFocus(above.key, "end");
      else if (controller.state.view.root !== null) controller.requestTitle();
    } else if (event.key === "ArrowDown" && !event.shiftKey && (element.selectionEnd === element.value.length || singleLine(element))) {
      const below = controller.neighbour(node.key, 1);
      stop();
      if (below !== undefined) controller.requestFocus(below.key, "end");
    } else if (event.key === "Escape") {
      stop();
      row.current?.focus();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    swipe.current = null;
    if (start === null || event.pointerType !== "touch") return;
    const dx = event.clientX - start.x;
    const tapped = Math.abs(dx) < TAP_SLACK_PX && Math.abs(event.clientY - start.y) < TAP_SLACK_PX;
    if (tapped && event.target instanceof Element && event.target.closest(".dot") !== null) {
      // a tap on the dot zooms even when a slow device never turns the touch into a click
      const to = `/b/${encodeURIComponent(bullet.id)}`;
      const from = location.pathname;
      window.setTimeout(() => {
        if (location.pathname !== from || location.pathname === to) return;
        controller.flushAll();
        zoomOrigin.rect = row.current?.querySelector(".cell")?.getBoundingClientRect() ?? null;
        navigate(to);
      }, 300);
    } else if (tapped && event.target instanceof Element && event.target.closest(".cell") !== null) {
      if (document.activeElement === area.current) controller.focusRow(node.key);
      else controller.requestFocus(node.key, "end");
    } else if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(event.clientY - start.y) <= SWIPE_SLACK_PX) {
      controller.focusRow(node.key);
      controller.structural(node.key, dx > 0 ? "indent" : "outdent");
    }
  };

  return (
    <div
      ref={row} role="treeitem" tabIndex={-1} aria-label={name} aria-level={node.level}
      aria-expanded={hasKids ? node.open : undefined} aria-selected={isFocused}
      data-bullet-id={bullet.id} data-key={node.key} data-top-row={node.level === 1 ? "" : undefined} data-depth={node.depth} data-collapsed={bullet.collapsed}
      data-completed={bullet.completed} data-mirror-of={bullet.mirrorOf ?? undefined}
      data-search={node.search ?? undefined}
      className={`row${hasKids ? " is-parent" : ""}${bullet.completed ? " is-complete" : ""}${node.search === "context" ? " is-context" : ""}`}
      onFocus={(event) => { if (event.target === event.currentTarget) controller.focusRow(node.key); }}
    >
      <div className="line" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}>
        {hasKids && (
          <button
            type="button" className="disclosure" aria-label={`Toggle children of ${label}`} aria-expanded={node.open}
            onMouseDown={(event) => event.preventDefault()} onClick={() => controller.toggleCollapse(node.key)}
          >
            <IconCollapse width={14} height={14} />
          </button>
        )}
        <Link
          to={`/b/${encodeURIComponent(bullet.id)}`} className="dot" aria-label={`Zoom into ${label}`}
          onClick={() => { controller.flushAll(); zoomOrigin.rect = row.current?.querySelector(".cell")?.getBoundingClientRect() ?? null; }}
        >
          <span aria-hidden="true" />
        </Link>
        <div className="cell">
          <span className="sizer" aria-hidden="true">{text}{"​"}</span>
          <div className="rendered" aria-hidden="true">
            {bullet.placeholder ? <span data-t={PLACEHOLDER_TEXT} /> : <RichText text={text} date={bullet.date} drawn />}
          </div>
          <textarea
            ref={area} rows={1} aria-label="Bullet text" value={bullet.placeholder ? "" : text} readOnly={bullet.placeholder}
            spellCheck={false} autoComplete="off" aria-autocomplete="list"
            onFocus={() => controller.focusRow(node.key)}
            onBlur={() => { controller.flush(key); suggestToken.current += 1; setSuggest(null); }}
            onChange={(event) => {
              controller.edit(bullet, event.target.value.replace(/[\r\n]+/g, " "));
              void openSuggestions(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
          />
          {suggest !== null && (
            <ul className="suggestions" role="listbox" aria-label="Suggestions">
              {suggest.items.map((item, index) => (
                <li
                  key={item.value} role="option" aria-selected={index === suggest.index} className="suggestion"
                  onMouseDown={(event) => { event.preventDefault(); setSuggest({ ...suggest, index }); insertSuggestion(item.value); }}
                >
                  {item.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {hasKids && (
        <Collapsible open={node.open}>
          <div role="group" className="group">{children}</div>
        </Collapsible>
      )}
    </div>
  );
}

export function Rows({ nodes, controller, focused, rootId }: {
  nodes: readonly RowNode[];
  controller: OutlineController;
  focused: string | null;
  rootId: string | null;
}) {
  const { view } = controller.state;
  return (
    <>
      {nodes.map((node) => {
        const inner = node.bullet.mirrorOf ?? node.bullet.id;
        const hasKids = !node.bullet.placeholder && (view.kids.get(inner)?.length ?? 0) > 0;
        return (
          <RowView key={node.key} node={node} controller={controller} focused={focused} rootId={rootId} hasKids={hasKids}>
            {hasKids && <Rows nodes={node.children} controller={controller} focused={focused} rootId={rootId} />}
          </RowView>
        );
      })}
    </>
  );
}

