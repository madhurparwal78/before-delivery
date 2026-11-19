import { isLiveState, isRunningState } from '../../shared/states';
import { ActionButton, useClassroom } from './context';
import { StartBreakoutsButton } from './BreakoutPanel';
import { Icon } from '../ui/icons';

/** Buttons for the actions legal in the session's state: the owner runs the class, a co-teacher only moves the slides. */
export function TeacherBar() {
  const { store, snapshot, isOwner, canRun, mode } = useClassroom();
  const { state, slide, locked } = snapshot;
  const teaching = isLiveState(state);
  if (!canRun || (!isOwner && !teaching)) return null;
  return (
    <div className="teacher-bar" role="group" aria-label="Teacher controls">
      {isOwner && state === 'scheduled' && (
        <ActionButton actionKey="open" className="primary" onPress={() => void store.changeState('open')}>
          Open class
        </ActionButton>
      )}
      {isOwner && state === 'open' && (
        <ActionButton actionKey="start" className="primary" onPress={() => void store.changeState('start')}>
          Start class
        </ActionButton>
      )}
      {teaching && (
        <>
          <ActionButton actionKey="slide-previous" disabled={slide.current <= 1} onPress={() => void store.moveSlide(-1)}>
            <Icon name="arrowUp" size={18} />
            Previous slide
          </ActionButton>
          <ActionButton actionKey="slide-next" disabled={slide.current >= slide.total} onPress={() => void store.moveSlide(1)}>
            <Icon name="arrowDown" size={18} />
            Next slide
          </ActionButton>
        </>
      )}
      {isOwner && teaching && (
        <ActionButton actionKey="lock" role="switch" aria-checked={locked} className="lock-switch" onPress={() => void store.setLocked(!locked)}>
          <Icon name="lock" size={18} />
          Lock class
        </ActionButton>
      )}
      {isOwner && state === 'live' && mode === 'phone' && <StartBreakoutsButton />}
      {isOwner && isRunningState(state) && (
        <ActionButton actionKey="end" className="end-class" onPress={() => void store.changeState('end')}>
          End class
        </ActionButton>
      )}
    </div>
  );
}
