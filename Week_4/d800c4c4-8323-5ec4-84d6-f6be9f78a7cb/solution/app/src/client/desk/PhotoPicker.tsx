import type { RefObject } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { MultipartBody } from "../api";

let pickerCount = 0;

/** `button "Take or choose photo"` with its own file input (camera on phones, file chooser elsewhere) and a thumbnail. */
export function PhotoPicker({
  photo,
  onPick,
  buttonRef,
  id,
}: {
  photo: File | null;
  onPick: (file: File) => void;
  buttonRef?: RefObject<HTMLButtonElement>;
  id?: string;
}) {
  const inputId = useMemo(() => `photo-input-${++pickerCount}`, []);
  const input = useRef<HTMLInputElement>(null);
  const thumbnail = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (thumbnail && URL.revokeObjectURL(thumbnail)), [thumbnail]);
  return (
    <div class="photo-picker">
      <button type="button" class="btn" id={id} ref={buttonRef} aria-controls={inputId} onClick={() => input.current?.click()}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
        Take or choose photo
      </button>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        class="file-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) onPick(file);
          e.currentTarget.value = "";
        }}
      />
      {thumbnail && <img class="thumbnail" src={thumbnail} alt="Picked photo" />}
    </div>
  );
}

/** A photo request body: the text fields, the capture time (the picked file's last-modified time) and the
 * photo's bytes, encoded as multipart/form-data in one buffer. */
export async function photoForm(fields: Record<string, string>, photo: File): Promise<MultipartBody> {
  const boundary = `pegworth-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const text = { ...fields, captured_at: new Date(photo.lastModified).toISOString() };
  for (const [name, value] of Object.entries(text)) {
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  const type = photo.type || "application/octet-stream";
  chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="photo"\r\nContent-Type: ${type}\r\n\r\n`));
  chunks.push(new Uint8Array(await photo.arrayBuffer()));
  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
