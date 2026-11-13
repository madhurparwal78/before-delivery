import { useEffect, useState } from 'react';
import { api, type Post } from './api.js';
import { proceduralField } from './procedural.js';
import { FileIcon } from './icons.js';
import type { JSX } from 'react';

interface LandingProps {
  navigate: (path: string) => void;
}

const DEMO_BOARD_ID = 'brd_seed_field_day';

export function Landing({ navigate }: LandingProps): JSX.Element {
  const [posts, setPosts] = useState<Post[]>([]);
  const [litIndex, setLitIndex] = useState<number | null>(null);

  useEffect(() => {
    api<{ sections: { posts: Post[] }[] }>(`/api/boards/${DEMO_BOARD_ID}/posts`)
      .then((r) => {
        const all = r.sections.flatMap((s) => s.posts);
        setPosts(all.slice(0, 12));
      })
      .catch(() => setPosts([]));
  }, []);

  const center = posts.findIndex((p) => p.title === 'Fern gully');
  const initialLit = center === -1 ? Math.floor((posts.length - 1) / 2) : center;
  void navigate;

  return (
    <main className="landing">
      <div className="corner tl">Pinsheet</div>
      <div className="corner tr">
        <a href="/signin">Sign in</a>
      </div>
      <div className="landing-strip" role="list">
        {posts.map((post, i) => {
          const lit = litIndex === null ? i === initialLit : litIndex === i;
          return (
            <div
              key={post.id}
              className={`strip-frame${lit ? ' lit' : ''}`}
              style={proceduralField(post.id)}
              role="listitem"
              tabIndex={0}
              onMouseEnter={() => setLitIndex(i)}
              onFocus={() => setLitIndex(i)}
              aria-label={post.title}
            >
              {post.attachment ? (
                post.attachment.content_type.startsWith('image/') ? (
                  <img src={post.attachment.url} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div className="frame-file-card">
                    <FileIcon />
                  </div>
                )
              ) : null}
              {lit && <span className="strip-title">{post.title}</span>}
            </div>
          );
        })}
      </div>
      <div className="corner bl">Boards your group fills together, live.</div>
      <div className="corner br">
        <a className="btn" href="/signup">Make a board</a>
      </div>
    </main>
  );
}
