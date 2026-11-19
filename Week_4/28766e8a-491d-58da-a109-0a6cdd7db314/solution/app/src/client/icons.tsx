// Inline thin line icons from the Lucide set (brief: Browser support), always aria-hidden.
import type { IconNode } from "lucide";
import {
  AlignStartVertical, ChevronLeft, ChevronRight, Circle, Diamond, Download, DraftingCompass, Ellipsis, Eye, EyeOff, FileOutput, History,
  Layers, ListTree, Lock, LockOpen, Magnet, MessageSquare, PanelRight, Plus, Redo2, Scan, Share2, SlidersHorizontal, Square,
  TriangleAlert, Type, Undo2, X, ZoomIn, ZoomOut,
} from "lucide";

export const icons = {
  rectangle: Square, ellipse: Circle, diamond: Diamond, text: Type, snap: Magnet, align: AlignStartVertical, undo: Undo2,
  redo: Redo2, zoomIn: ZoomIn, zoomOut: ZoomOut, reset: Scan, layers: Layers, panel: PanelRight, share: Share2,
  download: Download, export: FileOutput, outline: ListTree, eye: Eye, eyeOff: EyeOff, lock: Lock, unlock: LockOpen, plus: Plus,
  prev: ChevronLeft, next: ChevronRight, comment: MessageSquare, history: History, more: Ellipsis, close: X,
  alert: TriangleAlert, compass: DraftingCompass, inspector: SlidersHorizontal,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {icons[name].map(([tag, attrs], i) => {
        const Tag = tag as "path";
        return <Tag key={i} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
