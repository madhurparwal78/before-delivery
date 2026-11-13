import { proceduralField } from './procedural.js';
import type { Post } from './api.js';
import type { JSX } from 'react';

export function HeartIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function UpIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

export function DownIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </svg>
  );
}

export function BubbleIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function FileIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function FrameCounts({ post }: { post: Post }): JSX.Element {
  return (
    <span className="count-line">
      <span aria-hidden="true"><HeartIcon /> {post.likes}</span>
      <span aria-hidden="true"><UpIcon /> {post.score >= 0 ? post.score : post.score}</span>
      <span aria-hidden="true"><BubbleIcon /> {post.comments}</span>
    </span>
  );
}

export function FrameVisual({ post }: { post: Post }): JSX.Element {
  if (post.attachment && post.attachment.content_type.startsWith('image/')) {
    return (
      <>
        <img className="frame-image" src={post.attachment.url} alt="" />
        <div className="frame-title-band">{post.title}</div>
      </>
    );
  }
  if (post.attachment) {
    return (
      <>
        <div className="frame-file-card">
          <FileIcon />
          <span>{post.attachment.file_name}</span>
        </div>
        <div className="frame-title-band">{post.title}</div>
      </>
    );
  }
  return (
    <>
      <div className="frame-procedural" style={proceduralField(post.id)} />
      <div className="frame-title-band">{post.title}</div>
    </>
  );
}
