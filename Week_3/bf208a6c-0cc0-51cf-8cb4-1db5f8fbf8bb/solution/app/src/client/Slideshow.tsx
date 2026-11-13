import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { Dialog, useDialogClose } from "./Dialog";
import { Art, Counts } from "./Frame";
import { DURATION, EASE, reducedMotion } from "./motion";
import type { Listing, Post } from "../shared/types";

const SWIPE_PX = 50;

function Slide({ post }: { post: Post }) {
  return (
    <div className="slide-content">
      <div className="slide-art">
        <Art post={post} />
      </div>
      <h2 className="slide-title">{post.title}</h2>
      <p className="small muted">{post.author.display_name}</p>
      {post.body && <p className="slide-text">{post.body}</p>}
      <Counts post={post} />
    </div>
  );
}

export function Slideshow({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  return (
    <Dialog label="Slideshow" className="dialog-full" onClose={onClose}>
      <Slides posts={listing.sections.flatMap((section) => section.posts)} />
    </Dialog>
  );
}

function Slides({ posts }: { posts: Post[] }) {
  const close = useDialogClose();
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<{ post: Post; direction: 1 | -1 } | null>(null);
  const currentId = useRef<string | null>(posts[0]?.id ?? null);
  const entering = useRef<HTMLDivElement>(null);
  const exiting = useRef<HTMLDivElement>(null);
  const touchStart = useRef(0);

  useEffect(() => {
    const found = posts.findIndex((post) => post.id === currentId.current);
    if (found >= 0) {
      setIndex(found);
      return;
    }
    const next = Math.max(Math.min(index, posts.length - 1), 0);
    currentId.current = posts[next]?.id ?? null;
    setIndex(next);
  }, [posts]);

  useLayoutEffect(() => {
    if (!leaving) return;
    if (reducedMotion()) {
      setLeaving(null);
      return;
    }
    const options = { duration: DURATION.slide, easing: EASE };
    entering.current?.animate([{ transform: `translateX(${leaving.direction * 100}%)` }, { transform: "translateX(0)" }], options);
    const out = exiting.current?.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-leaving.direction * 100}%)` }], options);
    void out?.finished.then(() => setLeaving(null), () => undefined);
  }, [leaving]);

  const go = (target: number): void => {
    const next = Math.min(Math.max(target, 0), posts.length - 1);
    const from = posts[index];
    if (next === index || !from) return;
    currentId.current = posts[next]?.id ?? null;
    setLeaving({ post: from, direction: next > index ? 1 : -1 });
    setIndex(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number> = { ArrowRight: index + 1, " ": index + 1, PageDown: index + 1, ArrowLeft: index - 1, PageUp: index - 1, Home: 0, End: posts.length - 1 };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(target);
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>): void => {
    const shift = (event.changedTouches[0]?.clientX ?? 0) - touchStart.current;
    if (shift <= -SWIPE_PX) go(index + 1);
    else if (shift >= SWIPE_PX) go(index - 1);
  };

  const current = posts[index];
  return (
    <div className="slideshow" onKeyDown={onKeyDown} onKeyUp={(event) => event.key === " " && event.preventDefault()}>
      <div className="slides" onTouchStart={(event) => (touchStart.current = event.touches[0]?.clientX ?? 0)} onTouchEnd={onTouchEnd}>
        {leaving && (
          <div className="slide" ref={exiting} key={`out-${leaving.post.id}`}>
            <Slide post={leaving.post} />
          </div>
        )}
        {current && (
          <div className="slide" ref={entering} key={current.id}>
            <Slide post={current} />
          </div>
        )}
      </div>
      <div className="slide-controls">
        <button type="button" className="quiet" aria-label="Previous post" onClick={() => go(index - 1)}>
          Previous
        </button>
        <p role="status" aria-label="Slide position" className="slide-position">
          {current ? `Post ${index + 1} of ${posts.length}` : "No posts to show yet."}
        </p>
        <button type="button" className="quiet" aria-label="Next post" onClick={() => go(index + 1)}>
          Next
        </button>
      </div>
      <button type="button" className="quiet slide-close" aria-label="Close slideshow" onClick={close}>
        Close
      </button>
    </div>
  );
}
