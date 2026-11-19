import { memo } from "react";
import { Check, Pencil, Play, Trash2 } from "lucide-react";
import { copy } from "../../shared/copy";
import { formatInZone } from "../../shared/rules";
import type { LatestProject, RosterStudent } from "../../shared/types";
import { SnapshotStill } from "../render";
import { controlProps, removeKey, renameKey, watchKey } from "./controls";
import { useKeptSnapshot } from "./useKeptSnapshot";

function TileRender({ project }: { project: LatestProject }) {
  const { ref, snapshot } = useKeptSnapshot(project);
  return (
    <div className="tile-still" ref={ref}>
      {snapshot ? <SnapshotStill snapshot={snapshot} /> : null}
    </div>
  );
}

interface RosterTileProps {
  student: RosterStudent;
  timeZone: string;
  onWatch: (student: RosterStudent) => void;
  onRename: (student: RosterStudent) => void;
  onRemove: (student: RosterStudent) => void;
}

/** One design tile: the still render of the Student's latest project, its revision and save time, and the Student's actions. */
export const RosterTile = memo(function RosterTile({ student, timeZone, onWatch, onRename, onRemove }: RosterTileProps) {
  const project = student.latestProject;
  return (
    <li className="card roster-tile" aria-label={student.nickname}>
      <div className="tile-render">
        {project ? <TileRender project={project} /> : <p className="tile-empty">No saved project yet</p>}
        <button
          type="button"
          className="tile-watch"
          aria-label={`Watch ${student.nickname} live`}
          onClick={() => onWatch(student)}
          {...controlProps(watchKey(student.id))}
        >
          <Play size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="tile-body">
        <p className="tile-name">{student.nickname}</p>
        {project ? (
          <p className="tile-meta">
            <span className="figures">Rev {project.revision}</span>
            <span>{copy.savedAt(formatInZone(project.savedAt, timeZone))}</span>
          </p>
        ) : null}
        {student.handedIn ? (
          <p className="tile-flag"><Check size={16} aria-hidden="true" /><span>{copy.tileHandedIn}</span></p>
        ) : null}
        <div className="tile-actions">
          <button
            type="button"
            className="pill pill--outline pill--small"
            aria-label={`Rename ${student.nickname}`}
            onClick={() => onRename(student)}
            {...controlProps(renameKey(student.id))}
          >
            <Pencil size={16} aria-hidden="true" />Rename
          </button>
          <button
            type="button"
            className="pill pill--danger-quiet pill--small"
            aria-label={`Remove ${student.nickname}`}
            onClick={() => onRemove(student)}
            {...controlProps(removeKey(student.id))}
          >
            <Trash2 size={16} aria-hidden="true" />Remove
          </button>
        </div>
      </div>
    </li>
  );
});
