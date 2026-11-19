// Shared UI atoms: pills, fields, panels, dialogs, notices.

import { h } from "./runtime";
import type { VNode } from "preact";

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface BtnProps {
  children?: VNode | VNode[] | string | string[];
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "ghost";
  title?: string;
  describedBy?: string;
  type?: "button" | "submit";
  ariaLabel?: string;
  data?: Record<string, string>;
}

export function Btn(p: BtnProps): VNode {
  return h("button", {
    type: p.type ?? "button",
    class: cls("pill-btn", p.kind === "primary" && "pill-primary", p.kind === "secondary" && "pill-secondary", !p.kind && "pill-secondary"),
    onClick: p.onClick,
    disabled: p.disabled ?? false,
    "aria-disabled": p.disabled ? "true" : undefined,
    "aria-describedby": p.describedBy,
    title: p.title,
    "aria-label": p.ariaLabel,
    ...(p.data ?? {}),
  }, p.children ?? "");
}

export function StatusChip(status: string): VNode {
  return h("span", { class: cls("chip", "chip-" + status) }, status);
}

export function TestChip(): VNode {
  return h("span", { class: "chip chip-test" }, "Test");
}

export function VersionChip(version: number | null): VNode {
  return h("span", { class: "chip chip-version" }, version === null ? "Draft" : "Version " + version);
}

export interface FieldProps {
  label: string;
  value: string;
  onInput?: (v: string) => void;
  onBlur?: (v: string) => void;
  disabled?: boolean;
  describedBy?: string;
  type?: "text" | "number" | "password" | "email";
  role?: string;
  min?: number;
  id?: string;
}

export function Field(p: FieldProps): VNode {
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, p.label),
    p.role === "spinbutton"
      ? h("input", {
          class: "input", type: "number", value: p.value, min: p.min,
          onInput: (e: Event) => p.onInput?.((e.target as HTMLInputElement).value),
          onBlur: (e: Event) => p.onBlur?.((e.target as HTMLInputElement).value),
          disabled: p.disabled, "aria-describedby": p.describedBy, id: p.id,
          "aria-label": p.label,
        })
      : h("input", {
          class: "input", type: p.type ?? "text", value: p.value,
          onInput: (e: Event) => p.onInput?.((e.target as HTMLInputElement).value),
          onBlur: (e: Event) => p.onBlur?.((e.target as HTMLInputElement).value),
          disabled: p.disabled, "aria-describedby": p.describedBy, id: p.id,
          "aria-label": p.label,
        }),
  );
}

export function TextArea(p: { label: string; value: string; onInput?: (v: string) => void; onBlur?: (v: string) => void; disabled?: boolean }): VNode {
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, p.label),
    h("textarea", {
      class: "input area", rows: 3, value: p.value,
      onInput: (e: Event) => p.onInput?.((e.target as HTMLTextAreaElement).value),
      onBlur: (e: Event) => p.onBlur?.((e.target as HTMLTextAreaElement).value),
      disabled: p.disabled, "aria-label": p.label,
    }),
  );
}

export function Select(p: { label: string; value: string; options: (string | { value: string; label: string })[]; onChange: (v: string) => void; disabled?: boolean }): VNode {
  return h("label", { class: "field" },
    h("span", { class: "field-label" }, p.label),
    h("select", {
      class: "input select",
      onChange: (e: Event) => p.onChange((e.target as HTMLSelectElement).value),
      disabled: p.disabled,
      "aria-label": p.label,
    }, p.options.map((o) => {
      const v = typeof o === "string" ? o : o.value;
      const l = typeof o === "string" ? o : o.label;
      return h("option", { value: v, selected: v === p.value }, l);
    })),
  );
}

export function CheckBox(p: { label: string; checked: boolean; onChange: (v: boolean) => void }): VNode {
  return h("label", { class: "check" },
    h("input", { type: "checkbox", checked: p.checked, onChange: (e: Event) => p.onChange((e.target as HTMLInputElement).checked) }),
    h("span", {}, p.label),
  );
}

// A status region that keeps the latest 20 lines, newest last.
export function StatusLog(p: { name: string; lines: string[] }): VNode {
  return h("div", { class: "status-region", role: "status", "aria-label": p.name, tabIndex: -1 },
    p.lines.map((line, i) => h("p", { key: i, class: "status-line" }, line)));
}

export function AlertPanel(p: { message: string; onDismiss?: () => void }): VNode {
  return h("div", { class: "alert-panel" },
    h("p", { class: "alert-msg" }, p.message),
    p.onDismiss ? h("button", { class: "link-action", onClick: p.onDismiss }, "Dismiss") : null);
}

export function ProblemAlert(p: { message: string; field?: string; onLink?: () => void }): VNode {
  return h("div", { class: "alert-panel", role: "alert", "aria-label": "Problem" },
    h("p", {}, h("a", { href: "#", onClick: (e: Event) => { e.preventDefault(); p.onLink?.(); } }, p.message)));
}

export interface DialogProps {
  label: string;
  onClose: () => void;
  children: VNode[];
  onOpen?: (first: HTMLElement) => void;
}

export function Dialog(p: DialogProps): VNode {
  let firstFocus: HTMLElement | null = null;
  let lastFocus: HTMLElement | null = null;
  const ref = (el: HTMLElement | null) => {
    if (!el) return;
    const focusables = el.querySelectorAll<HTMLElement>("input,select,textarea,button,[tabindex='0']");
    if (focusables.length > 0) {
      firstFocus = focusables[0];
      lastFocus = focusables[focusables.length - 1];
      // Tab wrap
      el.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        if (e.shiftKey && document.activeElement === firstFocus) {
          e.preventDefault();
          lastFocus?.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocus) {
          e.preventDefault();
          firstFocus?.focus();
        }
      });
      firstFocus.focus();
      p.onOpen?.(firstFocus);
    }
  };
  return h("div", { class: "dialog-backdrop", onMouseDown: (e: MouseEvent) => { if (e.target === e.currentTarget) p.onClose(); } },
    h("div", { ref, class: "dialog", role: "dialog", "aria-label": p.label, "aria-modal": "true" }, p.children));
}
