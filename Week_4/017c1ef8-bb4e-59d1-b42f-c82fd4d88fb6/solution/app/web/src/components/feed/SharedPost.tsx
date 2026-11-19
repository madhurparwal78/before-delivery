import { Link } from 'react-router-dom';
import type { Post } from '../../types';
import { RichText } from './richtext';
import './feed.css';

/** The original post embedded in a repost with thoughts, or the placeholder once the original is gone. */
export function SharedPost({ post }: { post: Post | { unavailable: true } }) {
  return (
    <section aria-label="Shared post" className="shared-post">
      {'unavailable' in post ? (
        <p>This post is no longer available.</p>
      ) : (
        <>
          <p className="shared-author">
            <Link to={`/in/${post.author.handle}`}>{post.author.name}</Link>
          </p>
          <p className="muted">{post.author.headline}</p>
          <p className="post-text">
            <RichText text={post.text} mentions={post.mentions} />
          </p>
          {post.photo_url ? <img className="post-photo" src={post.photo_url} alt="Attached to the post" /> : null}
        </>
      )}
    </section>
  );
}
