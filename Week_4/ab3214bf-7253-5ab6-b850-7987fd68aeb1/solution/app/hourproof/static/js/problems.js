// The alert "Problems to fix": one link per field whose name is the field's error message; a refusal that names
// no field is plain text.
import { h } from "./dom.js";

export function problems() {
  const el = h("div", { role: "alert", "aria-label": "Problems to fix", class: "problems" });
  return {
    el,
    clear() { el.replaceChildren(); },
    // fields: [{message, target}] where target is the input to focus; message: plain text when no field is named
    show(message, fields = []) {
      el.replaceChildren();
      if (fields.length) {
        const list = h("ul");
        for (const { message: text, target } of fields) {
          const a = h("a", { href: `#${target.id}`, text });
          a.addEventListener("click", (event) => { event.preventDefault(); target.focus(); });
          list.append(h("li", {}, a));
        }
        el.append(list);
      }
      if (message) el.append(h("p", { text: message }));
    },
    fromError(error, fieldMap) {
      const named = Object.entries(error.fields || {}).filter(([name]) => fieldMap[name]);
      if (named.length) this.show("", named.map(([name, text]) => ({ message: text, target: fieldMap[name] })));
      else this.show(error.message, []);
    },
  };
}
