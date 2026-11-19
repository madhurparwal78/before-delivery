import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../../session';
import { announce } from '../../announce';
import { useLive } from '../../live';
import { firstName } from '../../format';
import type { DegreeValue, Profile } from '../../types';
import { Button } from '../../ui';
import { ConnectionActions } from './ConnectionActions';
import { ConnectionPath, type PathItem } from './ConnectionPath';
import { DegreeLabel, MutualLine, Numeral } from './DegreeBlock';
import { EditAboutDialog, EditEducationDialog, EditExperienceDialog, EditIntroDialog } from './EditDialogs';
import { useAfterRoll } from './motion';
import { PhotoDialog } from './PhotoDialog';
import { AboutSection, EducationSection, ExperienceSection } from './Sections';
import { Skills } from './Skills';
import './profile.css';

interface Props {
  profile: Profile;
  path: PathItem[];
  refresh: () => Promise<void>;
  /** The member pressed Block on this profile and confirmed. */
  blocked: boolean;
  onBlocked: () => void;
}

type Editing = 'intro' | 'about' | 'experience' | 'education' | 'photo' | null;

/** A member's profile: the degree numeral, then the mutual line, name, headline, location, actions, path and sections. */
export function ProfileView({ profile, path, refresh, blocked, onBlocked }: Props) {
  const own = profile.degree === 'self';
  const { signOut } = useSession();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing>(null);
  const manage = useRef<HTMLAnchorElement>(null);
  const shownDegree: DegreeValue | null = own ? null : blocked ? 'out' : (profile.degree as DegreeValue);
  const afterRoll = useAfterRoll(shownDegree ?? 'self');
  const blockedSentence = blocked && afterRoll;

  useLive('connected', (event) => {
    const { member } = event;
    if (member.id === profile.id) announce('Network announcements', `You are now connected with ${member.name}. 1st degree.`);
  });

  useEffect(() => {
    if (blockedSentence) manage.current?.focus();
  }, [blockedSentence]);

  const limited = !own && profile.visibility === 'connections' && profile.about === undefined;
  const hidden = !own && profile.visibility === 'private';
  const first = firstName(profile.name);
  const close = (): void => setEditing(null);

  return (
    <article className="pf">
      <header className="pf-top">
        <div className="pf-top-main">
          {shownDegree ? (
            <>
              <Numeral degree={shownDegree} />
              <DegreeLabel degree={shownDegree} />
              {blockedSentence ? null : <MutualLine handle={profile.handle} mutual={profile.mutual} />}
            </>
          ) : null}
          <h1 className="pf-name">{profile.name}</h1>
          <p className="pf-headline">{profile.headline}</p>
          {profile.location ? <p className="muted">{profile.location}</p> : null}
          {own ? (
            <div className="pf-actions" role="group" aria-label="Your profile">
              <Button onClick={() => setEditing('intro')}>Edit intro</Button>
              <Button className="pf-quiet" onClick={() => setEditing('photo')}>
                Change photo
              </Button>
              <Link to="/settings" className="button pf-quiet">
                Settings
              </Link>
              <Button
                className="pf-quiet"
                onClick={() => {
                  void signOut().then(() => navigate('/signin'));
                }}
              >
                Sign out
              </Button>
            </div>
          ) : blockedSentence ? null : (
            <ConnectionActions profile={profile} messageReady={afterRoll} onChanged={refresh} onBlocked={onBlocked} />
          )}
        </div>
        {profile.photo_url ? <img className="pf-photo" src={profile.photo_url} alt="" /> : null}
      </header>

      {blockedSentence ? (
        <div className="empty">
          <p className="empty-sentence">{`You blocked ${profile.name}.`}</p>
          <Link ref={manage} to="/settings" className="empty-action">
            Manage blocked members
          </Link>
        </div>
      ) : (
        <>
          {own || path.length === 0 ? null : <ConnectionPath path={path} />}
          {hidden ? <p className="pf-placeholder t-heading">{`${first} keeps this profile private.`}</p> : null}
          {limited ? <p className="pf-placeholder t-heading">{`${first} shares experience, education and skills with connections only.`}</p> : null}
          {!hidden && !limited ? (
            <div className="pf-sections">
              <div className="pf-column">
                <AboutSection about={profile.about ?? ''} onEdit={own ? () => setEditing('about') : undefined} />
                <ExperienceSection entries={profile.experience ?? []} onEdit={own ? () => setEditing('experience') : undefined} />
              </div>
              <div className="pf-column">
                <Skills profile={profile} owner={own} endorsable={!own && profile.degree === '1' && afterRoll} onChanged={refresh} />
                <EducationSection entries={profile.education ?? []} onEdit={own ? () => setEditing('education') : undefined} />
              </div>
            </div>
          ) : null}
        </>
      )}

      {own ? (
        <>
          <EditIntroDialog profile={profile} open={editing === 'intro'} onClose={close} onSaved={refresh} />
          <EditAboutDialog profile={profile} open={editing === 'about'} onClose={close} onSaved={refresh} />
          <EditExperienceDialog profile={profile} open={editing === 'experience'} onClose={close} onSaved={refresh} />
          <EditEducationDialog profile={profile} open={editing === 'education'} onClose={close} onSaved={refresh} />
          <PhotoDialog profile={profile} open={editing === 'photo'} onClose={close} onSaved={refresh} />
        </>
      ) : null}
    </article>
  );
}
