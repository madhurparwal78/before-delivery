export function formatUtc(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function signInEmailBody(link: string): string {
  return [
    "Here is your Relay Bench sign-in link.",
    "",
    `${link}`,
    "",
    "The link works once and expires soon.",
  ].join("\n");
}
