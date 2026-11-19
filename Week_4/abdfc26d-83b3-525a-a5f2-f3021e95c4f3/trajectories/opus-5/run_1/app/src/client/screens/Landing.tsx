import { useEffect, useRef, useState } from 'react';
import type { GalleryResponse, Piece } from '../../shared/api.js';
import { studioStatus } from '../../shared/copy.js';
import { api, ApiFailure } from '../lib/api.js';
import { useEnterOnce, useLoader } from '../lib/hooks.js';
import { PUBLIC_PIECE_SHADER } from '../lib/pieceShader.js';
import { primeUniforms, usePublicUniforms } from '../lib/pieceUniforms.js';
import { Link, signInTo, useRouter } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { EditionLens } from '../components/EditionLens.js';
import { PieceCard } from '../components/PieceCard.js';
import { PixelPanel, type AssistantState } from '../components/PixelPanel.js';
import { PlanCreditList } from '../components/PlanCreditList.js';
import { PromptBar } from '../components/PromptBar.js';
import { ArrowLink, SectionEyebrow, StatusRegion } from '../components/StatusRegion.js';
import { WorkflowStack } from '../components/WorkflowStack.js';
import { useEditionHold } from '../lib/useEditionHold.js';
import { Icon } from '../components/Icon.js';

const INITIAL_NUMERAL = 14;

function FeaturedStrip({
  title,
  creator,
  editionsLeft,
  slug,
  onRemix,
}: {
  title: string;
  creator: string;
  editionsLeft: number;
  slug: string;
  onRemix(): void;
}): JSX.Element {
  return (
    <section className="featured-strip" aria-label="Now playing">
      <span className="featured-strip__dash" aria-hidden="true" />
      <span className="featured-strip__title">{title}</span>
      <span className="featured-strip__creator muted">{creator}</span>
      <span className="featured-strip__engine muted">GLSL</span>
      <span className="featured-strip__left muted tabular">{editionsLeft} editions left</span>
      <a
        href={`/pieces/${slug}`}
        className="featured-strip__remix"
        onClick={(event) => {
          event.preventDefault();
          onRemix();
        }}
      >
        Remix
      </a>
    </section>
  );
}

function SplitIntro({
  eyebrowNumber,
  eyebrowName,
  headline,
  paragraph,
  link,
}: {
  eyebrowNumber: string;
  eyebrowName: string;
  headline: string;
  paragraph: string;
  link?: { to: string; label: string };
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const entered = useEnterOnce(ref);
  return (
    <div className={`split-intro${entered ? ' is-entered' : ''}`} ref={ref}>
      <div className="split-intro__left">
        <SectionEyebrow number={eyebrowNumber} name={eyebrowName} />
        <h2 className="split-intro__headline display">{headline}</h2>
      </div>
      <div className="split-intro__right">
        <p className="split-intro__paragraph muted">{paragraph}</p>
        {link && <ArrowLink to={link.to}>{link.label}</ArrowLink>}
      </div>
    </div>
  );
}

export function Landing(): JSX.Element {
  const { navigate } = useRouter();
  const session = useSession();
  const gallery = useLoader(() => api.get<GalleryResponse>('/api/gallery'), []);
  const featured = gallery.data?.featured ?? null;
  const uniforms = usePublicUniforms(featured?.slug ?? '');

  const [assistant, setAssistant] = useState<AssistantState>('idle');
  const [studioMessage, setStudioMessage] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);

  const hold = useEditionHold(featured?.slug ?? null, featured?.edition_count ?? 0);

  const describe = async (prompt: string): Promise<void> => {
    if (prompt.length < 3 || prompt.length > 500) {
      setPromptError(studioStatus.promptLength);
      return;
    }
    setPromptError(null);

    if (!session.user) {
      signInTo('/');
      return;
    }
    if (!session.isCreator) {
      setStudioMessage(studioStatus.notACreator);
      return;
    }

    setDescribing(true);
    setAssistant('drafting');
    setStudioMessage(studioStatus.describePending);
    try {
      const created = await api.post<{ piece: Piece }>('/api/pieces/describe', {
        body: { prompt },
      });
      primeUniforms(created.piece.slug, created.piece.uniforms);
      setAssistant('idle');
      setStudioMessage(studioStatus.describeSuccess);
      navigate(`/studio/pieces/${created.piece.slug}`);
    } catch (error) {
      setAssistant('error');
      if (error instanceof ApiFailure) {
        if (error.status === 503) setStudioMessage(studioStatus.providerOffline);
        else if (error.status === 502) setStudioMessage(studioStatus.providerMalformed);
        else if (error.status === 403) setStudioMessage(studioStatus.notACreator);
        else if (error.fields.prompt) setPromptError(error.fields.prompt);
        else setStudioMessage(error.message);
      }
    } finally {
      setDescribing(false);
    }
  };

  const remixFeatured = (): void => {
    if (!featured) return;
    navigate(`/pieces/${featured.slug}`);
  };

  return (
    <>
      <section className="hero" data-hero>
        {featured && (
          <EditionLens
            ref={hold.lensRef}
            slug={featured.slug}
            fragmentSource={PUBLIC_PIECE_SHADER}
            uniforms={uniforms}
            editionCount={featured.edition_count}
            editions={hold.editions}
            edition={hold.edition ?? Math.min(INITIAL_NUMERAL, featured.edition_count)}
            locked={hold.locked}
            onEditionChange={hold.setEdition}
            onClaim={hold.claim}
          />
        )}

        <div className="hero__overlay shell">
          <div className="hero__left">
            <WorkflowStack />
            <PromptBar pending={describing} fieldError={promptError} onSubmit={(p) => void describe(p)} />
            <StatusRegion label="Studio status" message={studioMessage} className="hero__studio-status" />
          </div>

          <div className="hero__right">
            {featured && (
              <FeaturedStrip
                title={featured.title}
                creator={featured.creator_display_name}
                editionsLeft={featured.editions_left}
                slug={featured.slug}
                onRemix={remixFeatured}
              />
            )}
          </div>
        </div>

        <StatusRegion
          label="Checkout status"
          message={hold.message}
          className="hero__checkout-status"
        />
        {hold.sheet}
      </section>

      <div className="shell landing-sections">
        <section className="landing-section">
          <SplitIntro
            eyebrowNumber="01"
            eyebrowName="Gallery"
            headline="Pieces that keep running."
            paragraph="Every live piece is a numbered run. Pick the frame you want and it is yours alone."
            link={{ to: '/gallery', label: 'Browse the gallery' }}
          />
          <div className="landing-section__cards">
            {(gallery.data?.sections[0]?.pieces ?? []).slice(0, 3).map((card, index) => (
              <PieceCard key={card.slug} card={card} index={index} />
            ))}
          </div>
        </section>

        <section className="landing-section">
          <SplitIntro
            eyebrowNumber="02"
            eyebrowName="Studio"
            headline="Tune it by hand."
            paragraph="Describe a piece, then take the faders yourself. Keyframe the timeline and render an export."
          />
          <div className="landing-section__studio">
            <PixelPanel state={assistant} />
            <PlanCreditList compact />
          </div>
        </section>

        <section className="landing-section">
          <SplitIntro
            eyebrowNumber="03"
            eyebrowName="Editions"
            headline="Every number is its own frame."
            paragraph="Each edition carries its own seed, its own invoice and its own split. Nothing is sold twice."
            link={{ to: '/gallery', label: 'How editions settle' }}
          />
        </section>
      </div>

      <section className="closing-band" aria-label="Start a piece">
        <span className="closing-band__stripe" aria-hidden="true" />
        <span className="closing-band__chevron" aria-hidden="true" />
        <div className="shell closing-band__inner">
          <h2 className="closing-band__headline display">
            <span>Start a</span> <span>piece</span>{' '}
            <span className="closing-band__last">tonight.</span>
          </h2>
          <div className="closing-band__side">
            <Link to="/studio" className="next-action next-action--large">
              Start a piece
              <Icon name="arrow-right" className="next-action__arrow" />
            </Link>
            <p className="muted">
              Creators keep 90% of every sale. Remixes pay the original creator 15%.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
