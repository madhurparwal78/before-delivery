import { useEffect, useState } from "react";
import { isListBlock, listNumbers } from "../domain/blocks.ts";
import type { BlockFields, BlockType } from "../domain/types.ts";
import { PaperStack } from "./common.tsx";

type SharedBlock = { id: string; type: BlockType; text: string; indent: number; checked: boolean };
type Shared = { title: string; blocks: SharedBlock[]; attachments: { id: string; name: string; contentType: string }[] };

const asFields = (block: SharedBlock): { id: string; fields: BlockFields } => ({
  id: block.id,
  fields: { ...block, documentId: "", order: "", card: null, tableId: null, attachmentId: null, fileName: "", updatedAt: 0, deleted: false },
});

export function SharedPage({ token }: { token: string }) {
  const [shared, setShared] = useState<Shared | null>(null);
  const [dead, setDead] = useState(false);
  useEffect(() => {
    fetch(`/api/shared/${encodeURIComponent(token)}`)
      .then(async (answer) => {
        if (answer.ok) setShared((await answer.json()) as Shared);
        else setDead(true);
      })
      .catch(() => setDead(true));
  }, [token]);
  if (dead) {
    return (
      <main className="shared">
        <section className="sheet shared-dead">
          <PaperStack />
          <h1>This link no longer works.</h1>
        </section>
      </main>
    );
  }
  if (!shared) return <main className="shared" />;
  const numbers = listNumbers(shared.blocks.map(asFields));
  return (
    <main className="shared" tabIndex={0}>
      <article className="sheet">
        <h1 className="shared-title">{shared.title || "Untitled"}</h1>
        {shared.blocks.map((block) => {
          const list = isListBlock(block.type);
          const style = list ? { marginInlineStart: block.indent * 24 } : undefined;
          if (block.type === "divider") return <hr key={block.id} />;
          const file = shared.attachments.find((attachment) => attachment.name === block.text);
          if ((block.type === "file" || block.type === "image") && file) {
            return <p key={block.id}><a className="text-link" href={`/api/shared/${encodeURIComponent(token)}/attachments/${file.id}`}>{file.name}</a></p>;
          }
          return (
            <div key={block.id} className={`shared-block shared-${block.type}`} style={style}>
              {block.type === "bulleted" && <span className="marker" aria-hidden="true">•</span>}
              {block.type === "numbered" && <span className="marker" aria-hidden="true">{numbers.get(block.id)}.</span>}
              {block.type === "todo" && <span className="card-tick" data-checked={block.checked || undefined} aria-hidden="true" />}
              <span>{block.text}</span>
            </div>
          );
        })}
        <footer className="shared-footer">Shared from Oddment. Read only.</footer>
      </article>
    </main>
  );
}
