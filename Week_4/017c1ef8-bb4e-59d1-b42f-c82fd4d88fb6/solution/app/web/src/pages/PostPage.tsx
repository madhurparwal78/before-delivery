import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { CommentTree } from '../components/feed/Comments';
import { PostEntry } from '../components/feed/Entry';
import { wasDeletedHere } from '../components/feed/store';
import type { Post } from '../types';
import { EmptyState } from '../ui';
import '../components/feed/feed.css';

export default function PostPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | 'gone' | null>(null);

  useEffect(() => {
    setPost(null);
    void api
      .get<Post>(`/api/posts/${postId}`)
      .then(setPost)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) setPost('gone');
      });
  }, [postId]);

  const gone = useCallback(
    (id: string): void => {
      if (wasDeletedHere(id)) navigate('/feed');
      else setPost('gone');
    },
    [navigate],
  );

  if (post === null) return <h1 className="sr-only">Post</h1>;
  if (post === 'gone') {
    return <EmptyState heading="h1" sentence="This post is no longer available." action={{ label: 'Go to Home', to: '/feed' }} />;
  }
  return (
    <div className="stack">
      <h1 className="sr-only">Post</h1>
      <PostEntry post={post} standalone onGone={gone} />
      <h2 className="sr-only comments-heading">Comments</h2>
      <CommentTree postId={post.id} postAuthorId={post.author.id} />
    </div>
  );
}
