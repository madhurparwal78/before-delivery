import type { AspectRatio, ExportFormat, Resolution } from '../../../shared/api.js';
import { PixelPanel, type AssistantState } from '../../components/PixelPanel.js';

const ASPECTS: readonly AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];
const RESOLUTIONS: readonly Resolution[] = ['720p', '1080p'];
const FORMAT_LABELS: readonly { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
];

export interface RenderFooterProps {
  readonly assistantState: AssistantState;
  readonly format: ExportFormat;
  readonly resolution: Resolution;
  readonly aspect: AspectRatio;
  readonly durationSeconds: number;
  readonly cost: number;
  readonly available: number;
  readonly dirty: boolean;
  readonly isDraft: boolean;
  readonly queued: boolean;
  onFormat(value: ExportFormat): void;
  onResolution(value: Resolution): void;
  onAspect(value: AspectRatio): void;
  onDuration(value: number): void;
  onRender(): void;
  onCancel(): void;
  onUploadAudio(): void;
  onUploadFont(): void;
  onUploadModel(): void;
}

/**
 * The export choices and the render button. The button is dimmed and disabled
 * when the balance is short or there are unsaved changes.
 */
export function RenderFooter({
  assistantState,
  format,
  resolution,
  aspect,
  durationSeconds,
  cost,
  available,
  dirty,
  isDraft,
  queued,
  onFormat,
  onResolution,
  onAspect,
  onDuration,
  onRender,
  onCancel,
  onUploadAudio,
  onUploadFont,
  onUploadModel,
}: RenderFooterProps): JSX.Element {
  const blocked = dirty || cost > available || !isDraft;

  return (
    <div className="render-footer">
      <div className="render-footer__uploads">
        <button type="button" className="ghost-button" onClick={onUploadAudio}>
          Upload audio stem
        </button>
        <button type="button" className="ghost-button" onClick={onUploadFont}>
          Upload font
        </button>
        <button type="button" className="ghost-button" onClick={onUploadModel}>
          Upload model
        </button>
      </div>

      <div className="render-footer__choices">
        <fieldset>
          <legend className="field__label">Aspect ratio</legend>
          <div role="radiogroup" aria-label="Aspect ratio" className="chip-row">
            {ASPECTS.map((value) => (
              <label key={value} className="radio">
                <input
                  type="radio"
                  name="aspect"
                  value={value}
                  checked={aspect === value}
                  onChange={() => onAspect(value)}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="field__label">Resolution</legend>
          <div role="radiogroup" aria-label="Resolution" className="chip-row">
            {RESOLUTIONS.map((value) => (
              <label key={value} className="radio">
                <input
                  type="radio"
                  name="resolution"
                  value={value}
                  checked={resolution === value}
                  onChange={() => onResolution(value)}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="field__label">Format</legend>
          <div role="radiogroup" aria-label="Format" className="chip-row">
            {FORMAT_LABELS.map((option) => (
              <label key={option.value} className="radio">
                <input
                  type="radio"
                  name="format"
                  value={option.value}
                  checked={format === option.value}
                  onChange={() => onFormat(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field field--inline" htmlFor="duration-seconds">
          <span className="field__label">Duration (seconds)</span>
          <input
            id="duration-seconds"
            type="number"
            aria-label="Duration (seconds)"
            min={5}
            max={60}
            step={1}
            value={durationSeconds}
            onChange={(event) => onDuration(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="render-footer__action">
        <PixelPanel state={assistantState} size="small" />
        <button
          type="button"
          className={`next-action render-button${blocked ? ' render-button--dim' : ''}`}
          disabled={blocked}
          onClick={onRender}
        >
          Render {aspect} · {cost} credits
        </button>
        {queued && (
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel render
          </button>
        )}
        <p className="render-footer__balance muted tabular">{available} credits available</p>
      </div>
    </div>
  );
}
