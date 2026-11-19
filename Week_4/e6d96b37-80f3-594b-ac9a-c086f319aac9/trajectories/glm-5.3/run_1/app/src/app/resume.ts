import { feedback } from "./feedback.js";

export interface PendingCommand {
  path: string;
  method: "POST" | "PUT" | "DELETE";
  commandId: string;
  body?: unknown;
  form?: { fields: Record<string, string>; files: Record<string, { name: string; type: string; dataBase64: string }> };
}

const RESUME_KEY = "flan:pending-command";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function stageForResume(command: PendingCommand): void {
  window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(command));
}

export function takeStagedResume(): PendingCommand | null {
  const raw = window.sessionStorage.getItem(RESUME_KEY);
  if (!raw) return null;
  window.sessionStorage.removeItem(RESUME_KEY);
  return JSON.parse(raw) as PendingCommand;
}

export async function resumeStagedCommand(command: PendingCommand): Promise<{ ok: boolean; message: string }> {
  let init: RequestInit;
  if (command.form) {
    const form = new FormData();
    for (const [name, value] of Object.entries(command.form.fields)) {
      form.append(name, value);
    }
    for (const [name, file] of Object.entries(command.form.files)) {
      form.append(name, new File([base64ToArrayBuffer(file.dataBase64)], file.name, { type: file.type }));
    }
    init = { method: command.method, body: form };
  } else if (command.body !== undefined) {
    init = { method: command.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.body) };
  } else {
    init = { method: command.method };
  }
  const res = await fetch(command.path, init);
  const parsed = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (!res.ok) {
    return { ok: false, message: parsed?.message ?? feedback("F_SERVICE") };
  }
  return { ok: true, message: parsed?.message ?? "" };
}

export async function readFileAsBase64(file: File): Promise<string> {
  return arrayBufferToBase64(await file.arrayBuffer());
}
