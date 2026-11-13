/**
 * Inbox and the published rules page.
 */
import { addLiveHandler, announce, api, ApiFail, displayIso, showNotice } from "./api";
import { emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";

interface InboxItem {
  id: number;
  rule_name: string;
  group: string;
  text: string;
  at: string;
  acknowledged_by: string | null;
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The inbox feed: one outlined article per item, newest first. */
export function buildInbox(view: HTMLElement): void {
  const feed = h("div", { role: "feed", "aria-label": "Inbox" });
  const holder = h("div", {});
  view.append(holder);
  async function load(): Promise<void> {
    try {
      const res = await api<{ items: InboxItem[] }>("/api/inbox");
      feed.replaceChildren();
      for (const item of res.items) {
        const article = h("article", { class: "card", "aria-label": item.text });
        article.append(Object.assign(document.createElement("div"), { textContent: item.text, className: "mono" }));
        if (item.acknowledged_by) {
          article.append(
            Object.assign(document.createElement("div"), {
              textContent: `Acknowledged by ${item.acknowledged_by}`,
              className: "muted",
            }),
          );
        } else {
          const ack = h("button", { class: "btn", "aria-label": "Acknowledge" }, "Acknowledge");
          const addToCase = h("button", { class: "btn", "aria-label": "Add to case" }, "Add to case");
          ack.addEventListener("click", async () => {
            try {
              await api(`/api/inbox/${item.id}/ack`, { method: "POST" });
              announce(`Acknowledged Group ${item.group}`);
              void load();
            } catch (err) {
              if (err instanceof ApiFail) showNotice(err.body.message);
            }
          });
          addToCase.addEventListener("click", () => openAddToCase({ inbox_item: item.id }));
          const row = h("div", { style: { display: "flex", gap: "6px", marginTop: "8px" } });
          row.append(ack, addToCase);
          article.append(row);
        }
        feed.append(article);
      }
      holder.replaceChildren(feed);
      if (res.items.length === 0) {
        const link = document.createElement("a");
        link.href = "/alerts";
        link.textContent = "Alerts";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          goTo("/alerts");
        });
        holder.append(emptyBand("Nothing in the inbox.", link));
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }
  addLiveHandler("inbox", () => void load());
  addLiveHandler("alert", () => void load());
  void load();
}

function openAddToCase(body: Record<string, unknown>): void {
  openModal(
    (close) => {
      const box = h("div", {});
      box.append(h("h3", {}, "Add to case"));
      const combo = h("select", { class: "input", "aria-label": "Case" }) as HTMLSelectElement;
      const add = h("button", { class: "btn-main" }, "Add");
      const cancel = h("button", { class: "btn" }, "Cancel");
      cancel.addEventListener("click", close);
      void (async () => {
        try {
          const res = await api<{ cases: { number: number; title: string; status: string }[] }>("/api/cases");
          for (const c of res.cases.filter((c) => c.status !== "closed")) {
            combo.append(Object.assign(document.createElement("option"), { value: String(c.number), textContent: `Case ${c.number}: ${c.title}` }));
          }
          combo.append(Object.assign(document.createElement("option"), { value: "new", textContent: "New case" }));
        } catch {
          combo.append(Object.assign(document.createElement("option"), { value: "new", textContent: "New case" }));
        }
      })();
      add.addEventListener("click", async () => {
        add.setAttribute("aria-busy", "true");
        try {
          let caseNumber = combo.value;
          if (caseNumber === "new") {
            const created = await api<{ number: number }>("/api/cases", {
              method: "POST",
              body: JSON.stringify({ title: "New case" }),
              headers: { "Content-Type": "application/json" },
            });
            caseNumber = String(created.number);
            announce(`Case ${caseNumber} is now open`);
          }
          await api(`/api/cases/${caseNumber}/items`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          });
          showNotice(`Added to case ${caseNumber}.`);
          close();
        } catch (err) {
          if (err instanceof ApiFail) showNotice(err.body.message);
        } finally {
          add.removeAttribute("aria-busy");
        }
      });
      const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
      row.append(add, cancel);
      box.append(combo, row);
      return box;
    },
    null,
    "Add to case",
  );
}


/** The published rules accordion: fourteen rows, one per rule A to N. */
export function buildRules(view: HTMLElement): void {
  const rules: [string, string, string][] = [
    ["01 Streams and mappings", "Field types", "A field's type is inferred from its first value in the generation, trying number, then date, then boolean, then text. An explicit mapping can only be added for a field the write generation does not have yet, and it wins over inference."],
    ["02 Bulk upload", "Line errors", "Each line is one JSON object with a required @timestamp. Lines succeed independently, and each failed line goes to the failure store with its raw text. For example: Line 5: field status expects number, got text."],
    ["03 Pipelines", "Processors", "A pipeline is an ordered list of processors. Each processor may have one condition, and on any processor failure the event goes to the failure store with: Pipeline <name> failed at processor <k>: <reason>."],
    ["04 Text analysis", "Analyzers", "The standard analyzer splits the value into runs of ASCII letters and digits, lower-cases each run, drops stopwords and applies the suffix table. Positions are 0-based, and every run takes a position, dropped stopwords included."],
    ["05 Relevance", "Scoring", "Each scoring leaf has value = idf x tf_norm x boost, with k1 = 1.2 and b = 0.75. Each leaf's value is rounded to 4 decimals, half away from zero, and the score is the sum of the rounded values."],
    ["06 Spoor Query", "Syntax", "Field:value, phrases in double quotes, existence as field:*, ranges on number and date fields, wildcards within one token, grouped values and object scopes, with NOT binding tightest, then AND, then OR."],
    ["07 Explore", "Histogram", "The interval is the smallest of 1s to 1w for which at most 60 buckets touch the range. Bucket Brush sets the range from the first selected bucket's start to the last selected bucket's end."],
    ["08 Moving data", "Snapshots", "A snapshot freezes its whole ordered result list when created, so pages never repeat or skip an event while others upload or roll over. A snapshot expires once the server clock reaches its last use plus the expiry time."],
    ["09 Spoor Pipe", "Commands", "FROM, WHERE, STATS, SORT, LIMIT and KEEP. Without STATS the rows are events and the columns are _id, @timestamp, then every other field alphabetically. avg shows at most 4 decimals."],
    ["10 Lifecycle", "Phases", "A generation rolls over when its age since it became the write generation reaches the max age, or its event count reaches the max events. The last three phases are measured from the generation's rollover time."],
    ["11 Alert rules", "Windows", "At check time T, each group's value covers events with @timestamp in (max(T - window, B), T], where B is when the group last entered active or recovered, so no event counts toward two state changes."],
    ["12 Alert handling", "Flapping", "A group is flapping while its state changed on at least the threshold of its last checks, the current one included. While flapping, no action fires for the group, and tracking goes on."],
    ["13 Traces and objectives", "Self time", "Self time is a span's duration minus the length of the union of its children's intervals, clipped to the span. The critical path starts at the real root with the latest end."],
    ["14 Spaces and keys", "Isolation", "A space isolates its streams, events, rules, inbox, cases and every derived surface. A key is shown once, stored only as a hash, and belongs to the space it was made in."],
  ];
  const wrap = h("div", {});
  wrap.append(h("h1", {}, "Published rules"));
  wrap.style.maxWidth = "860px";
  for (const [title, subtitle, body] of rules) {
    const btn = h("button", { class: "btn", "aria-expanded": "false" }, title);
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    btn.style.display = "flex";
    btn.style.justifyContent = "space-between";
    btn.style.marginTop = "6px";
    const bodyEl = h("div", { class: "card mono" });
    bodyEl.style.display = "none";
    bodyEl.style.fontSize = "13px";
    bodyEl.textContent = `${subtitle}. ${body}`;
    btn.addEventListener("click", () => {
      const open = bodyEl.style.display === "none";
      bodyEl.style.display = open ? "block" : "none";
      btn.setAttribute("aria-expanded", String(open));
    });
    wrap.append(btn, bodyEl);
  }
  view.append(wrap);
}
