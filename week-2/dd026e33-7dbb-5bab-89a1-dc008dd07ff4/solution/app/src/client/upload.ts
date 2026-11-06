// File uploads with byte progress (brief: Feedback states › Upload progress). Progress follows the
// bytes sent but stops at 95 until the server answers; the caller shows 100 only on a 201.
import type { ErrorBody } from "../shared/api.js";
import { HttpError, Interrupted, NoAnswer, endSession, sessionEndOf, signInAgain } from "./api.js";

export function upload<T>(path: string, fields: [string, string][], file: File | null, onProgress: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    for (const [name, value] of fields) form.append(name, value);
    if (file) form.append("file", file, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(95, Math.floor((event.loaded * 100) / event.total)));
    });
    xhr.addEventListener("error", () => reject(new NoAnswer()));
    xhr.addEventListener("abort", () => reject(new NoAnswer()));
    xhr.addEventListener("load", () => {
      let body: unknown = {};
      try {
        body = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : {};
      } catch {
        reject(new NoAnswer());
        return;
      }
      const end = sessionEndOf(xhr.status, body);
      if (end === "session_expired") {
        signInAgain().then(() => reject(new Interrupted()), reject);
        return;
      }
      if (end) endSession(end);
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new HttpError(xhr.status, body as ErrorBody));
    });
    xhr.send(form);
  });
}
