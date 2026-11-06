import { Archive, CircleDot, Clock, Lightbulb, PackageCheck } from "lucide-react";
import { FEATURE_STATUS_LABELS, type FeatureStatus } from "../../shared/lifecycles.js";

const ICONS = { candidate: Lightbulb, planned: CircleDot, in_progress: Clock, released: PackageCheck, archived: Archive };

/** A feature status as a word with its icon, never colour alone. */
export function StatusWord({ status }: { status: FeatureStatus }) {
  const Icon = ICONS[status];
  return <span className={`status-word status-${status}`}><Icon aria-hidden="true" size={14} />{FEATURE_STATUS_LABELS[status]}</span>;
}
