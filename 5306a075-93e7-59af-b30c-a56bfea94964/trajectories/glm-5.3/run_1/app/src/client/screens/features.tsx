import { api } from "../api.js";
import { h, icon } from "../dom.js";
import { currentApp } from "../main.js";
import { feedback, statusLabel } from "../ui.js";
import { twoDecimals } from "../dom.js";

/** The ranked feature list (DP-18, DP-32, DP-40). */
export async function renderFeatures(
  _screen: HTMLElement,
  fail: (err: unknown) => void,
): Promise<HTMLElement> {
  const root = h("div", null);
  let features: Awaited<ReturnType<typeof api.features>>["features"] = [];

  const exportButton = h(
    "button",
    {
      onclick: async (event: MouseEvent) => {
        const button = event.currentTarget as HTMLElement;
        button.textContent = "Preparing export…";
        const response = await fetch("/api/exports/features.csv", { credentials: "same-origin" });
        button.textContent = "Export CSV";
        if (!response.ok) {
          feedback?.alert("Something went wrong on our side. Nothing was saved.");
          return;
        }
        const blob = await response.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "evidence-desk-features.csv";
        link.click();
        URL.revokeObjectURL(link.href);
      },
    },
    "Export CSV",
  );

  const render = (): void => {
    root.replaceChildren();
    const head = h("div", { class: "toolbar-actions" },
      h("h2", null, "Feature ranking"),
      currentApp()?.user.role === "head_of_product" ? exportButton : null,
    );
    root.appendChild(head);

    const table = h("table", { class: "rank-table", "aria-label": "Feature ranking" });
    const thead = h("thead", null,
      h("tr", null,
        h("th", null, "Rank"),
        h("th", null, "Feature"),
        h("th", null, "Status"),
        h("th", null, "Insights"),
        h("th", null, "Companies"),
        h("th", null, "Impact"),
        h("th", null, "Effort"),
        h("th", null, "Confidence"),
        h("th", null, "Objective fit"),
        h("th", null, "Priority"),
      ),
    );
    table.appendChild(thead);
    const tbody = h("tbody", null);
    for (const feature of features) {
      const row = h("tr", null,
        h("td", { class: "num" }, String(feature.rank)),
        h("td", null, h("a", { href: `/features/${feature.id}`, "data-nav": true }, feature.name)),
        h("td", null, h("span", { class: "status-chip" }, icon(statusIcon(feature.status), 14), statusLabel(feature.status))),
        h("td", { class: "num" }, String(feature.insightCount)),
        h("td", { class: "num" }, String(feature.companyCount)),
        h("td", { class: "num" }, String(feature.impact)),
        h("td", { class: "num" }, String(feature.effort)),
        h("td", { class: "num" }, `${feature.confidence}%`),
        h("td", { class: "num" }, twoDecimals(feature.objectiveFit)),
        h("td", { class: "num priority-col" }, twoDecimals(feature.priority)),
      );
      // A Details disclosure shows the hidden values below 900 pixels.
      const details = h("details", { class: "details-disclosure" },
        h("summary", null, "Details"),
        h("dl", null,
          h("dt", null, "Status"), h("dd", null, statusLabel(feature.status)),
          h("dt", null, "Insights"), h("dd", null, String(feature.insightCount)),
          h("dt", null, "Companies"), h("dd", null, String(feature.companyCount)),
          h("dt", null, "Impact"), h("dd", null, String(feature.impact)),
          h("dt", null, "Effort"), h("dd", null, String(feature.effort)),
          h("dt", null, "Confidence"), h("dd", null, `${feature.confidence}%`),
          h("dt", null, "Objective fit"), h("dd", null, twoDecimals(feature.objectiveFit)),
        ),
      );
      row.querySelector("td:nth-child(2)")?.appendChild(details);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    root.appendChild(table);
  };

  try {
    const result = await api.features();
    features = result.features;
    render();
  } catch (err) {
    fail(err);
  }
  return root;
}

export function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    candidate: "CircleDashed",
    planned: "Circle",
    in_progress: "Clock",
    released: "CircleCheck",
    archived: "EyeOff",
    open: "Circle",
    frozen: "Snowflake",
    shipped: "CircleCheck",
  };
  return icons[status] ?? "Circle";
}
