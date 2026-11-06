// Status chips drawn as counter stamps: each state has its own shape as well as its colour (brief: Status chips).
import type { StatusCode } from "../../shared/api";

function chipClass(status: StatusCode): string {
  switch (status) {
    case "CNF":
      return "chip chip--cnf";
    case "RAC":
      return "chip chip--rac";
    case "CAN":
    case "CHART_NOT_CONFIRMED":
      return "chip chip--struck";
    case "NOSB":
      return "chip chip--nosb";
    default:
      return "chip chip--wl";
  }
}

/** The state a status label stands for, for screens that receive labels only. */
export function statusOfLabel(label: string): StatusCode {
  if (label === "NOT CNF") return "CHART_NOT_CONFIRMED";
  const head = label.split(" ")[0] ?? "";
  return (["CNF", "RAC", "CAN", "NOSB", "GNWL", "RLWL", "PQWL", "TQWL"].includes(head) ? head : "GNWL") as StatusCode;
}

export function Chip({ status, label, striking = false }: { status: StatusCode; label: string; striking?: boolean }) {
  return <span className={`${chipClass(status)}${striking ? " striking" : ""}`}>{label}</span>;
}
