import { useEffect } from "react";
import type { NotebookStore } from "./store";

const TEXT_FIELD = "input, textarea, select, [contenteditable='true']";
const ACTIVATES = "button, a, [role='menuitem']";

/** Keys that need a second press: D,D deletes, I,I interrupts, 0,0 restarts. */
type Pending = { key: string; at: number } | null;

/** Installs the notebook's keyboard: command-mode keys, the keys that work in both modes, and the double presses. */
export function useNotebookKeys(store: NotebookStore): void {
  useEffect(() => {
    let pending: Pending = null;

    const double = (key: string): boolean => {
      const now = Date.now();
      if (pending && pending.key === key && now - pending.at <= store.limits.double_press_ms) {
        pending = null;
        return true;
      }
      pending = { key, at: now };
      return false;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !store.state.meta) return;
      const target = event.target as HTMLElement;
      const state = store.state;
      const inside = (selector: string): boolean => target.closest(selector) !== null;
      const inField = target.matches(TEXT_FIELD) && !(target instanceof HTMLTextAreaElement && target.readOnly);
      const editor = state.mode === "edit" && target.matches("textarea");
      const mod = event.ctrlKey || event.metaKey;
      const act = (work: () => Promise<void>): void => {
        event.preventDefault();
        store.command(work);
      };

      if (state.dialog) return;
      if (inside("[role='dialog']")) return;

      // Keys that work in both modes, whichever notebook control has focus.
      if (!inside("[role='menu']")) {
        if (mod && event.shiftKey && event.code === "KeyC") {
          event.preventDefault();
          store.open({ kind: "palette" });
          return;
        }
        if (mod && !event.shiftKey && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (store.canEdit) store.command(() => store.saveCheckpoint());
          return;
        }
        if (event.key === "Enter" && (event.shiftKey || mod || event.altKey) && !inside("button, a")) {
          if (!store.canEdit) return;
          event.preventDefault();
          const then = event.altKey ? "insert" : event.shiftKey ? "advance" : "stay";
          store.command(() => store.run(then));
          return;
        }
      }

      if (editor) {
        if (event.key === "Escape") {
          event.preventDefault();
          store.leaveEdit();
        } else if (mod && event.shiftKey && event.code === "Minus") {
          event.preventDefault();
          const box = target as HTMLTextAreaElement;
          const line = box.value.slice(0, box.selectionStart).split("\n").length;
          store.command(() => store.split(line));
        }
        return;
      }
      if (inField || inside("[role='menu']")) return;

      if (event.key === "Escape") {
        if (state.mode === "edit") store.leaveEdit();
        else if (state.comparison) store.closeComparison();
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === "Enter" || event.key === " ") {
        if (target.matches(ACTIVATES) || target.closest(ACTIVATES)) return;
        if (event.key === "Enter") act(async () => store.enterEdit());
        return;
      }

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const viewer = !store.canEdit;
      switch (key) {
        case "ArrowUp":
        case "k":
          event.preventDefault();
          store.step(-1, event.shiftKey && key === "ArrowUp");
          return;
        case "ArrowDown":
        case "j":
          event.preventDefault();
          store.step(1, event.shiftKey && key === "ArrowDown");
          return;
        default:
          break;
      }
      if (viewer) return;
      switch (key) {
        case "a":
          if (!event.shiftKey) act(async () => void (await store.insert("above")));
          return;
        case "b":
          if (!event.shiftKey) act(async () => void (await store.insert("below")));
          return;
        case "m":
          if (event.shiftKey) act(() => store.merge());
          else act(async () => store.retype("markdown"));
          return;
        case "y":
          act(async () => store.retype("code"));
          return;
        case "d":
          if (double("d")) act(() => store.remove());
          return;
        case "z":
          act(() => store.undoDelete());
          return;
        case "c":
          store.copy();
          return;
        case "x":
          act(() => store.cut());
          return;
        case "v":
          act(() => store.paste());
          return;
        case "i":
          if (double("i")) store.interrupt();
          return;
        case "0":
          if (double("0")) store.open({ kind: "restart" });
          return;
        default:
          return;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [store]);
}
