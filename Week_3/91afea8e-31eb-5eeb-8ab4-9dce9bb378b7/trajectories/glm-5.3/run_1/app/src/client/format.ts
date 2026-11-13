/** Indian-format money and promise dates, shared by every screen. */
export function amount(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let s = String(rupees);
  if (s.length > 3) {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const groups: string[] = [];
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest) groups.unshift(rest);
    s = groups.join(",") + "," + last3;
  }
  return `${negative ? "-" : ""}₹${s}.${String(p).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dateLabel(ymd: string): string {
  const plain = ymd.slice(0, 10);
  const [y, m, d] = plain.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function methodLabel(method: string, last4?: string | null): string {
  if (method === "card") return last4 ? `card ending ${last4}` : "card";
  if (method === "emi") return "card EMI";
  if (method === "netbanking") return "net banking";
  if (method === "balance") return "Chauraha balance";
  return method;
}
