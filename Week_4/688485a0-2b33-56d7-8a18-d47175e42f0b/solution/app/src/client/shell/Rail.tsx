import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { CollectionSummary, ProjectInfo } from "../api.js";
import { useDialogClose } from "../components/Dialog.js";
import { Link, collectionPath } from "../router.js";

const SECTION_LABEL: Record<string, string> = {
  documents: "Documents",
  queries: "Query",
  pipeline: "Pipeline",
  indexes: "Indexes",
  schema: "Schema",
  rules: "Rules",
  members: "Members",
};

interface Props {
  project: ProjectInfo | null;
  collections: CollectionSummary[] | null;
  cid: string | null;
  section: string | null;
  inDrawer?: boolean;
}

/** The left rail: project name, section tag and the collections (also the content of the phone drawer). */
export function RailContent({ project, collections, cid, section, inDrawer = false }: Props): ReactNode {
  return (
    <nav className="rail" aria-label="Project" aria-busy={project === null || collections === null || undefined}>
      {inDrawer ? <DrawerClose /> : null}
      <p className="rail-project">{project ? <Link to={`/p/${project.id}`}>{project.name}</Link> : <span className="skeleton-line" />}</p>
      {section ? <span className="section-tag">{SECTION_LABEL[section]}</span> : null}
      <ul className="rail-collections">
        {collections === null ? (
          <li className="skeleton-line" />
        ) : (
          collections.map((collection) => (
            <li key={collection.id}>
              <CollectionLink pid={project?.id ?? ""} collection={collection} current={collection.id === cid} inDrawer={inDrawer} />
            </li>
          ))
        )}
      </ul>
    </nav>
  );
}

function CollectionLink({ pid, collection, current, inDrawer }: { pid: string; collection: CollectionSummary; current: boolean; inDrawer: boolean }): ReactNode {
  const close = useDialogClose();
  return (
    <Link to={collectionPath(pid, collection.id)} className="rail-link" aria-current={current ? "page" : undefined} onClick={inDrawer ? close : undefined}>
      {collection.name}
    </Link>
  );
}

function DrawerClose(): ReactNode {
  const close = useDialogClose();
  return (
    <button type="button" className="btn btn-icon drawer-close" aria-label="Close collections" onClick={close}>
      <X size={20} aria-hidden="true" />
    </button>
  );
}
