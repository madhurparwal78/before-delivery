// The public form page.

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api } from "../runtime";
import type { ApiError } from "../runtime";
import { Btn } from "../ui";

interface FormMeta { name: string; fields: { name: string; label: string; type: string }[] }

export function FormPage(p: { slug: string; path: string }): VNode {
  const [fields, setFields] = useState<FormMeta | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // fetch the form shape from the API route (a 404 means no live version)
    void api<unknown>(`/api/forms/${p.slug}/${p.path}`).then(() => undefined).catch((e) => {
      const err = e as ApiError;
      if (err.status === 404) setMissing(true);
    });
    void fetch(`/forms/${p.slug}/${p.path}`, { credentials: "same-origin" }).then((r) => r.text()).then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const name = doc.querySelector("h1")?.textContent ?? "Form";
      const labels = Array.from(doc.querySelectorAll("label")).map((l) => l.getAttribute("aria-label") ?? l.textContent ?? "");
      setFields({ name, fields: labels.filter(Boolean).map((l, i) => ({ name: "f" + i, label: l, type: "text" })) });
    }).catch(() => setMissing(true));
  }, [p.slug, p.path]);

  if (missing) {
    return h("div", { class: "auth-page" },
      h("div", { class: "dark-panel auth-panel notfound-panel" },
        h("h1", { class: "auth-heading" }, "We couldn't find that page"),
        h("p", { class: "notfound-line" }, "It may have moved, or you may not have access to it."),
        h("a", { class: "link-action", href: "/", onClick: (e: Event) => { e.preventDefault(); location.href = "/"; } }, "Back to start")));
  }
  if (!fields) return h("div", { class: "auth-page" }, h("div", { class: "dark-panel auth-panel" }, h("p", { class: "ok-note" }, "Working...")));

  const submit = async () => {
    try {
      await api(`/api/forms/${p.slug}/${p.path}`, { method: "POST", body: JSON.stringify(values) });
      setDone(true);
      setNotice("Thanks, your response was received.");
    } catch (e) {
      const err = e as ApiError;
      setNotice(err.message);
    }
  };

  return h("div", { class: "auth-page" },
    h("div", { class: "dark-panel auth-panel form-panel" },
      h("h1", { class: "auth-heading" }, fields.name),
      done
        ? h("p", { class: "ok-note", role: "status" }, "Thanks, your response was received.")
        : h("form", { onSubmit: (e: Event) => { e.preventDefault(); void submit(); } },
            notice ? h("p", { class: "ok-note", role: "status" }, notice) : null,
            fields.fields.map((f) => h("label", { class: "field" },
              h("span", { class: "field-label" }, f.label),
              h("input", {
                class: "input", value: values[f.name] ?? "",
                onInput: (e: Event) => setValues((prev) => ({ ...prev, [f.name]: (e.target as HTMLInputElement).value })),
                "aria-label": f.label,
              }))),
            h(Btn, { kind: "primary", type: "submit" }, "Submit"))));
}
