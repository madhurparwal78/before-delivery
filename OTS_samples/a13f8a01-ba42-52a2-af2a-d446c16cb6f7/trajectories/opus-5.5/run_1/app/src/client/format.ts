const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(iso: string | number): string {
  const date = new Date(iso);
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} ${formatTime(date)}`;
}

export function likesText(count: number): string {
  return count === 1 ? "1 like" : `${count} likes`;
}

export function forksText(count: number): string {
  return count === 1 ? "1 fork" : `${count} forks`;
}

export function versionLabel(head: number): string {
  return head === 0 ? "Not saved yet" : `Version ${head}`;
}

export function pensFoundText(total: number): string {
  if (total === 0) return "No pens match";
  return total === 1 ? "1 pen found" : `${total} pens found`;
}

export function changeCounts(added: number, removed: number): string {
  return `+${added} \u2212${removed}`;
}

export function unverifiedText(email: string): string {
  return `Verify your email to do this. We sent a link to ${email}.`;
}
