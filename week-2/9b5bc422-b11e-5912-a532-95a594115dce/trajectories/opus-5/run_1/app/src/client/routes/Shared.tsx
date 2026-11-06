import { useEffect, useState } from 'react';
import { empty } from '../../domain/copy.ts';

type SharedDocument = {
  title: string;
  blocks: { id: string; type: string; text: string; indent: number; checked: boolean }[];
  attachments: { id: string; name: string; contentType: string }[];
};

export function Shared(props: { token: string }) {
  const [document_, setDocument] = useState<SharedDocument | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    void fetch(`/api/shared/${props.token}`)
      .then(async (response) => {
        if (response.status !== 200) {
          setDead(true);
          return;
        }
        setDocument((await response.json()) as SharedDocument);
      })
      .catch(() => setDead(true));
  }, [props.token]);

  if (dead) {
    return (
      <main className="screen shared-screen">
        <h1 className="display">{empty.deadLink}</h1>
      </main>
    );
  }

  if (!document_) return <main className="screen shared-screen" />;

  return (
    <main className="screen shared-screen">
      <article className="paper sheet">
        <h1 className="display">{document_.title || 'Untitled'}</h1>
        {document_.blocks.map((block) => (
          <div key={block.id} data-block-id={block.id} data-block-type={block.type} data-indent={block.indent}>
            {block.type === 'divider' ? <hr /> : <p className={`block-${block.type}`}>{block.text}</p>}
          </div>
        ))}
        {document_.attachments.map((attachment) => (
          <p key={attachment.id}>
            <a href={`/api/shared/${props.token}/attachments/${attachment.id}`}>{attachment.name}</a>
          </p>
        ))}
      </article>
      <footer className="shared-footer">{empty.sharedFooter}</footer>
    </main>
  );
}
