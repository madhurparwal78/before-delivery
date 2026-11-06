import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface SharedBlock {
  id: string;
  type: string;
  text: string;
  indent: number;
  checked: boolean;
}

export function SharedScreen() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ok' | 'dead'>('loading');
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<SharedBlock[]>([]);

  useEffect(() => {
    void fetch(`/api/shared/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          setState('dead');
          return;
        }
        const body = await res.json();
        setTitle(body.title);
        setBlocks(body.blocks ?? []);
        setState('ok');
      })
      .catch(() => setState('dead'));
  }, [token]);

  if (state === 'loading') return null;

  if (state === 'dead') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="paper" style={{ maxWidth: 480, padding: 32, textAlign: 'center' }}>
          <h1>This link no longer works.</h1>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px' }}>
      <div className="sheet" style={{ width: '100%', maxWidth: 720, flex: 'initial' }}>
        <h1 style={{ fontSize: '1.7rem', marginBottom: 16 }}>{title || 'Untitled'}</h1>
        {blocks.map((b) => (
          <p
            key={b.id}
            style={{
              margin: '6px 0',
              fontWeight: b.type.startsWith('heading') ? 700 : 400,
              fontStyle: b.type === 'quote' ? 'italic' : undefined,
              marginLeft: b.indent * 24,
              fontFamily: b.type.startsWith('heading') ? "'Newsreader', serif" : undefined,
              fontSize: b.type === 'heading1' ? '1.6rem' : b.type === 'heading2' ? '1.3rem' : b.type === 'heading3' ? '1.15rem' : undefined,
            }}
          >
            {b.type === 'todo' ? (b.checked ? '☑ ' : '☐ ') : ''}
            {b.type === 'bulleted' ? '• ' : ''}
            {b.text}
          </p>
        ))}
      </div>
      <p className="meta" style={{ marginTop: 16, color: '#e8e0c8' }}>Shared from Oddment. Read only.</p>
    </div>
  );
}
