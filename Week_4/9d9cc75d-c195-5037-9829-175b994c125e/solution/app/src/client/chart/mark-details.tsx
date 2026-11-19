import { BottomSheet } from '../ui/dialog.tsx';
import type { MarkDetailsProps } from './props.ts';

export function MarkDetails({ mark, onClose }: MarkDetailsProps) {
  if (!mark) return null;
  return (
    <BottomSheet name="Mark details" dataSheet="bottom" onClose={onClose}>
      <p className="mark-details-text">{mark.tooltip}</p>
    </BottomSheet>
  );
}
