import { useRef, useState } from "react";
import type { Specimen } from "../../shared/types.js";
import { ApiError, postForm, useDesk } from "../desk_context.js";
import { feedback } from "../feedback.js";
import { ReviewDialog, useCommand } from "../review.js";

interface StagedPhoto {
  file: File;
  url: string;
  valid: boolean;
  error?: string;
}

interface SlotError {
  obverse?: string;
  reverse?: string;
}

async function validatePhoto(file: File, limits: { maxBytes: number; minEdge: number; maxEdge: number; maxPixels: number }): Promise<string | null> {
  if (file.size > limits.maxBytes) {
    return feedback("F_PHOTO_BYTES", { max: limits.maxBytes });
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const kind = detectKind(bytes);
  if (kind === "svg") return feedback("F_PHOTO_SVG");
  if (kind === null) return feedback("F_PHOTO_TYPE");
  const dims = readDimensions(kind, bytes);
  if (dims === null) return feedback("F_PHOTO_TYPE");
  const longEdge = Math.max(dims.width, dims.height);
  if (longEdge < limits.minEdge || longEdge > limits.maxEdge) {
    return feedback("F_PHOTO_EDGE", { min: limits.minEdge, max: limits.maxEdge });
  }
  if (dims.width * dims.height > limits.maxPixels) {
    return feedback("F_PHOTO_PIXELS", { max: limits.maxPixels });
  }
  return null;
}

function detectKind(bytes: Uint8Array): "jpeg" | "png" | "webp" | "svg" | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<")) return "svg";
  return null;
}

function readDimensions(kind: "jpeg" | "png" | "webp", bytes: Uint8Array): { width: number; height: number } | null {
  if (kind === "png") {
    if (bytes.length < 24) return null;
    return { width: be32(bytes, 16), height: be32(bytes, 20) };
  }
  if (kind === "webp") {
    const fourcc = new TextDecoder("latin1").decode(bytes.slice(12, 16));
    if (fourcc === "VP8 ") return { width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff };
    if (fourcc === "VP8L") {
      return {
        width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
        height: 1 + (((bytes[24] & 0xf) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)),
      };
    }
    if (fourcc === "VP8X") {
      return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    }
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function be32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function le16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

const LIMITS = { maxBytes: 5000000, minEdge: 1000, maxEdge: 8000, maxPixels: 40000000 };

export function IntakeWorkspace(): React.ReactElement {
  const desk = useDesk();
  const runCommand = useCommand();
  const [obverse, setObverse] = useState<StagedPhoto | null>(null);
  const [reverse, setReverse] = useState<StagedPhoto | null>(null);
  const [reference, setReference] = useState("");
  const [slotErrors, setSlotErrors] = useState<SlotError>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [created, setCreated] = useState<Specimen | null>(null);
  const [pickedUp, setPickedUp] = useState<"obverse" | "reverse" | null>(null);
  const namespace = desk.session?.namespace ?? "hollowmint";

  const stagePhoto = async (face: "obverse" | "reverse", file: File | undefined) => {
    if (!file) return;
    const error = await validatePhoto(file, LIMITS);
    const staged: StagedPhoto = { file, url: URL.createObjectURL(file), valid: error === null, error: error ?? undefined };
    if (face === "obverse") setObverse(staged);
    else setReverse(staged);
    setSlotErrors((prev) => ({ ...prev, [face]: error ?? undefined }));
  };

  const swapSlots = () => {
    const o = obverse;
    setObverse(reverse);
    setReverse(o);
  };

  const dropOnSlot = async (face: "obverse" | "reverse", event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    await stagePhoto(face, file);
    setPickedUp(null);
  };

  const review = () => {
    const errors: SlotError = {};
    if (!obverse) errors.obverse = feedback("F_PHOTO_MISSING");
    if (!reverse) errors.reverse = feedback("F_PHOTO_MISSING");
    if (!/^[A-Za-z0-9-]{1,80}$/.test(reference)) {
      setSlotErrors((prev) => ({ ...prev }));
      desk.reportError(feedback("F_INVALID"));
      return;
    }
    setSlotErrors(errors);
    if (Object.keys(errors).length > 0) {
      desk.reportError(feedback("F_INVALID"));
      return;
    }
    setReviewOpen(true);
  };

  const confirmCreate = async () => {
    const commandId = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await runCommand(commandId, async () => {
      const form = new FormData();
      form.append("command_id", commandId);
      form.append("reference", reference);
      form.append("obverse", obverse?.file as File);
      form.append("reverse", reverse?.file as File);
      try {
        const result = await postForm<{ specimen: Specimen }>(`/api/desks/${namespace}/specimens`, form);
        desk.announce(feedback("F_INTAKE_OK"));
        setCreated(result.specimen);
        setReviewOpen(false);
        setObverse(null);
        setReverse(null);
        setReference("");
        await desk.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          desk.reportError(err.failure.body.message);
          if (err.failure.body.fields) {
            setSlotErrors(err.failure.body.fields);
          }
          return;
        }
        throw err;
      }
    });
  };

  return (
    <div aria-label="Intake workspace">
      <h2 className="desk-main-heading">Intake</h2>
      <div className="workspace-grid">
        <div className="panel">
          <h3>Obverse</h3>
          <div
            className="viewer"
            style={{ minHeight: 220 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnSlot("obverse", e)}
          >
            {obverse ? <img className="viewer-image" src={obverse.url} alt="" /> : null}
          </div>
          <button
            className="btn"
            aria-label="Obverse photo"
            onClick={() => document.getElementById("obverse-input")?.click()}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", "obverse");
              setPickedUp("obverse");
            }}
          >
            Obverse photo
          </button>
          <button
            className="btn"
            aria-label="Obverse slot"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnSlot("obverse", e)}
            onKeyDown={(e) => {
              if (pickedUp === "reverse" && e.key === "Enter") swapSlots();
              if (pickedUp === null && e.key === " ") {
                e.preventDefault();
                setPickedUp("obverse");
              }
            }}
            onClick={() => {
              if (pickedUp === "reverse") swapSlots();
            }}
          >
            Obverse slot
          </button>
          <input
            id="obverse-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => stagePhoto("obverse", e.target.files?.[0])}
          />
          {slotErrors.obverse && <span className="field-error">{slotErrors.obverse}</span>}
        </div>
        <div className="panel">
          <h3>Reverse</h3>
          <div
            className="viewer"
            style={{ minHeight: 220 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnSlot("reverse", e)}
          >
            {reverse ? <img className="viewer-image" src={reverse.url} alt="" /> : null}
          </div>
          <button
            className="btn"
            aria-label="Reverse photo"
            onClick={() => document.getElementById("reverse-input")?.click()}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", "reverse");
              setPickedUp("reverse");
            }}
          >
            Reverse photo
          </button>
          <button
            className="btn"
            aria-label="Reverse slot"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => dropOnSlot("reverse", e)}
            onKeyDown={(e) => {
              if (pickedUp === "obverse" && e.key === "Enter") swapSlots();
              if (pickedUp === null && e.key === " ") {
                e.preventDefault();
                setPickedUp("reverse");
              }
            }}
            onClick={() => {
              if (pickedUp === "obverse") swapSlots();
            }}
          >
            Reverse slot
          </button>
          <input
            id="reverse-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => stagePhoto("reverse", e.target.files?.[0])}
          />
          {slotErrors.reverse && <span className="field-error">{slotErrors.reverse}</span>}
        </div>
        <div className="field">
          <label htmlFor="specimen-reference">Specimen reference:</label>
          <input
            id="specimen-reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div>
          <button className="btn btn-primary" aria-label="Review intake" onClick={review}>
            Review intake
          </button>
        </div>
      </div>
      {reviewOpen && (
        <ReviewDialog
          title="Create specimen"
          summary={`Specimen ${reference} with both photographs staged.`}
          onConfirm={() => void confirmCreate()}
          onCancel={() => setReviewOpen(false)}
        />
      )}
      {created && <h3>{created.display_label}</h3>}
    </div>
  );
}
