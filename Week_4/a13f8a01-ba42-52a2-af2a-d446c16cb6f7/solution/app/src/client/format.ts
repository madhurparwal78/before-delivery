const pad = (value: number): string => String(value).padStart(2, "0");

export function formatDate(iso: string): string {
  const moment = new Date(iso);
  const month = moment.toLocaleString("en-US", { month: "short" });
  return `${moment.getDate()} ${month} ${moment.getFullYear()} ${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

export function formatClock(moment: number): string {
  const date = new Date(moment);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
