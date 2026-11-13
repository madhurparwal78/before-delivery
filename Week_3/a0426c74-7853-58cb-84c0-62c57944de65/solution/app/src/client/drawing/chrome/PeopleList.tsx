import { useDrawingSlice, useDrawingStore } from '../../store/index.ts';
import { Button } from '../../ui/index.ts';

/** `list "People here"`: everyone with the drawing open, in their presence colour, with `button "Follow <user>"` for the others (the follow ends when the follower pans or zooms). */
export function PeopleList({ me }: { me: string | null }) {
  const store = useDrawingStore();
  const members = useDrawingSlice((snapshot) => snapshot.members);
  return (
    <ul className="people" role="list" aria-label="People here">
      {members.map((member) => (
        <li key={member.username} className="people__item" data-colour={member.colour}>
          <span className="people__dot" style={{ background: `var(--presence-${member.colour})` }} aria-hidden="true" />
          <span>{member.username}</span>
          {member.username === me ? null : <Button onClick={() => store.follow(member.username)}>{`Follow ${member.username}`}</Button>}
        </li>
      ))}
    </ul>
  );
}
