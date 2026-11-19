import { type ReactNode, useState } from "react";
import { asFailure, del, post } from "../api.js";
import { ConfirmDialog, useOverlay } from "../components/Dialog.js";
import { displayNumber, plural } from "../../shared/display.js";
import { Link, collectionPath, navigate } from "../router.js";
import { useShell } from "../shell/ProjectShell.js";

export function ProjectHome(): ReactNode {
  const { project, role, collections, reloadCollections } = useShell();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const confirm = useOverlay();
  const owner = role === "owner";
  const create = async (): Promise<void> => {
    setMessage("");
    try {
      await post(`/api/projects/${project.id}/collections`, { name });
      setName("");
      await reloadCollections();
    } catch (error) {
      const failure = asFailure(error);
      setMessage(failure.body.error === "name_taken" ? "A collection with this name already exists" : "Collection names use letters, digits, _ and - (1 to 64)");
    }
  };
  return (
    <>
      <h1>{project.name}</h1>
      <p className="muted">
        Owned by {project.owner.name}. You are {role === "owner" ? "the owner" : `an ${role === "editor" ? "editor" : "reader"}`}.
      </p>
      <h2>Collections</h2>
      <ul className="rows" role="list" aria-label="Collections">
        {collections.map((collection) => (
          <li key={collection.id} className="row">
            <Link to={collectionPath(project.id, collection.id)} className="row-link">
              {collection.name}
            </Link>
            <span className="count">{plural(collection.count, "document")}</span>
          </li>
        ))}
      </ul>
      {collections.length === 0 ? <p className="muted">No collections yet.</p> : null}
      {owner ? (
        <>
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="field">
              <span className="field-label">Collection name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <p className="status-line" role="status" aria-label="Collections status">
              {message}
            </p>
            <div className="actions">
              <button type="submit" className="btn btn-lime">
                Create collection
              </button>
            </div>
          </form>
          <div className="actions danger-zone">
            <button type="button" className="btn" onClick={() => confirm.open(true)}>
              Delete project
            </button>
          </div>
        </>
      ) : null}
      {confirm.slot ? (
        <ConfirmDialog
          key={confirm.slot.id}
          name={`Delete project ${project.name}?`}
          text={`Delete ${project.name} with ${displayNumber(collections.length)} ${collections.length === 1 ? "collection" : "collections"} and everything in them? This cannot be undone.`}
          onClose={confirm.closeFor(confirm.slot.id)}
          onConfirm={() => {
            del(`/api/projects/${project.id}`).then(() => navigate("/projects"), () => undefined);
          }}
        />
      ) : null}
    </>
  );
}
