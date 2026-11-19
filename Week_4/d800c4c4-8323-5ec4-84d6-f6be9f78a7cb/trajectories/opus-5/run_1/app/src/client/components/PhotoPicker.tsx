import { forwardRef, useRef } from 'react';

export interface PickedPhoto {
  readonly file: File;
  readonly previewUrl: string;
  /** The file's last-modified time, which is the photo's capture time. */
  readonly capturedAt: string;
}

function isoWithOffset(moment: Date): string {
  const offset = -moment.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}:${pad(moment.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

export function readPicked(file: File): PickedPhoto {
  const stamp = new Date(file.lastModified);
  const capturedAt = Number.isNaN(stamp.getTime()) ? new Date() : stamp;
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    capturedAt: isoWithOffset(capturedAt),
  };
}

interface PhotoPickerProps {
  readonly inputId: string;
  readonly picked: PickedPhoto | null;
  readonly onPick: (picked: PickedPhoto) => void;
}

/**
 * The button opens the device camera on phones and the file chooser elsewhere.
 * Its own file input stays in the page and the button names it in aria-controls,
 * so picking a file in the input counts as choosing it through the button.
 */
export const PhotoPicker = forwardRef<HTMLButtonElement, PhotoPickerProps>(
  function PhotoPicker({ inputId, picked, onPick }, ref): JSX.Element {
    const input = useRef<HTMLInputElement>(null);
    return (
      <span className="photo-picker">
        <button
          type="button"
          ref={ref}
          aria-controls={inputId}
          onClick={() => input.current?.click()}
        >
          Take or choose photo
        </button>
        <input
          id={inputId}
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="photo-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(readPicked(file));
          }}
        />
        {picked ? <img className="photo-thumb" src={picked.previewUrl} alt="Chosen photo" /> : null}
      </span>
    );
  },
);
