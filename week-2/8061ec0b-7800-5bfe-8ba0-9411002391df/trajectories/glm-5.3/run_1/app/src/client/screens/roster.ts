// The roster (DP-28, DP-29, DP-30, DP-31, DP-63).
import { api } from "../api.js";
import { h } from "../ui/dom.js";
import { statusIcon, type StatusIconName } from "../ui/icons.js";
import { formatDateShort } from "../format.js";
import type { RenderContext } from "../router.js";
import { DELIVERY_STATUS_WORDS, DELIVERY_STATUS_ORDER, instrumentLabel, type DeliveryStatus } from "../../shared/domain.js";

interface RosterResponse {
  school: { id: string; name: string; delivery_weekday: string };
  next_delivery_date: string;
  counts: Record<string, number>;
  students: {
    student_id: string;
    student_name: string;
    grade: number;
    instrument_type: string | null;
    size: string | null;
    serial: string | null;
    delivery_date: string | null;
    delivery_status: DeliveryStatus;
  }[];
}

export async function renderRoster(ctx: RenderContext): Promise<void> {
  let schoolId: string;
  const user = ctx.user!;
  if (user.role === "owner") {
    schoolId = ctx.query.get("school") ?? "larkspur";
  } else {
    schoolId = user.school_id ?? "";
  }
  const data = await api<RosterResponse>("GET", `/api/schools/${encodeURIComponent(schoolId)}/roster`);
  ctx.root.appendChild(h("h1", { text: `${data.school.name} roster` }));
  ctx.root.appendChild(h("p", { class: "muted", text: `Next delivery day: ${formatDateShort(data.next_delivery_date)}` }));

  const scheduled = (data.counts.scheduled ?? 0) + (data.counts.delivered ?? 0) + (data.counts.owned ?? 0);
  const total = data.students.length;
  const summaryLine = h("p", { text: `${scheduled} of ${total} students have an instrument` });
  const summaryList = h("ul", { class: "roster-summary-list", "aria-label": "Roster summary" });
  for (const status of DELIVERY_STATUS_ORDER) {
    const li = h("li", {});
    li.appendChild(statusIcon(status));
    li.appendChild(document.createTextNode(` ${DELIVERY_STATUS_WORDS[status]}: ${data.counts[status] ?? 0}`));
    summaryList.appendChild(li);
  }
  const csvLink = h("a", {
    class: "btn btn-secondary",
    href: `/api/schools/${encodeURIComponent(schoolId)}/roster.csv`,
    text: "Download roster CSV",
    download: "",
  });
  ctx.root.append(summaryLine, summaryList, csvLink);

  const band = currentBand();
  const columns =
    band === "narrow"
      ? ["Student", "Instrument", "Serial", "Status"]
      : band === "medium"
        ? ["Student", "Instrument", "Size", "Serial", "Delivery day", "Status"]
        : ["Student", "Grade", "Instrument", "Size", "Serial", "Delivery day", "Status"];

  const table = h("table", { class: "register-table roster-table", "aria-label": "Roster" });
  const headRow = h("tr", {});
  for (const col of columns) headRow.appendChild(h("th", { scope: "col", text: col }));
  table.appendChild(h("thead", {}, headRow));
  const tbody = h("tbody", {});
  for (const student of data.students) {
    const tr = h("tr", {});
    tr.appendChild(h("td", { text: student.student_name }));
    if (band === "wide") tr.appendChild(h("td", { class: "mono", text: String(student.grade) }));
    tr.appendChild(
      h("td", {
        text: student.instrument_type
          ? instrumentLabel(student.instrument_type as never, student.size as never)
          : "—",
      })
    );
    if (band !== "narrow") tr.appendChild(h("td", { class: "mono", text: student.size ?? "—" }));
    tr.appendChild(h("td", { class: "mono", text: student.serial ?? "—" }));
    if (band !== "narrow") {
      tr.appendChild(h("td", { class: "mono", text: student.delivery_date ? formatDateShort(student.delivery_date) : "—" }));
    }
    const statusCell = h("td", { class: "status-cell" });
    statusCell.appendChild(statusIcon(student.delivery_status as StatusIconName));
    statusCell.appendChild(document.createTextNode(` ${DELIVERY_STATUS_WORDS[student.delivery_status]}`));
    tr.appendChild(statusCell);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  ctx.root.appendChild(table);
}

function currentBand(): "narrow" | "medium" | "wide" {
  const width = window.innerWidth;
  if (width < 640) return "narrow";
  if (width < 1024) return "medium";
  return "wide";
}
