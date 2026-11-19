export function newSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
}

export function firstName(name: string): string {
  const index = name.indexOf(" ");
  return index === -1 ? name : name.slice(0, index);
}

export function escapeText(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}
