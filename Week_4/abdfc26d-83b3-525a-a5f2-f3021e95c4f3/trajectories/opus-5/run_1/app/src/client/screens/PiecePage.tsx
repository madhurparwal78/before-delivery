import type { Piece } from '../../shared/api.js';
import { studioStatus } from '../../shared/copy.js';
import { formatUsd } from '../../shared/money.js';
import { api } from '../lib/api.js';
import { useLoader } from '../lib/hooks.js';
import { PUBLIC_PIECE_SHADER, publicUniformsFrom } from '../lib/pieceShader.js';
import { Link, useRouter } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { useEditionHold } from '../lib/useEditionHold.js';
import { EditionLens } from '../components/EditionLens.js';
import { StatusRegion } from '../components/StatusRegion.js';
import { useState } from 'react';
import { Icon } from '../components/Icon.js';

export function PiecePage({ slug }: { slug: string }): JSX.Element {
  const session = useSession();
  const { navigate } = useRouter();
  const piece = useLoader(() => api.get<Piece>(`/api/pieces/${slug}`), [slug]);
  const [remixMessage, setRemixMessage] = useState<string | null>(null);

  const editionCount = piece.data?.edition_count ?? 0;
  const hold = useEditionHold(slug, editionCount);

  if (piece.error) {
    return (
      <div className="shell piece-page">
        <h1 className="display">This piece is not here.</h1>
        <Link to="/gallery" className="next-action">
          Browse the gallery
          <Icon name="arrow-right" className="next-action__arrow" />
        </Link>
      </div>
    );
  }

  const data = piece.data;
  if (!data) return <div className="shell piece-page" />;

  const uniforms = publicUniformsFrom(data.uniforms);
  const edition = hold.edition ?? 1;
  const seedHash =
    hold.editions.find((entry) => entry.number === edition)?.seed_hash ?? '';
  const canRemix = session.isCreator && session.user?.id !== data.creator.id && data.remix_of === null;

  const remix = (): void => {
    void (async () => {
      try {
        const created = await api.post<{ piece: Piece }>(`/api/pieces/${slug}/remix`);
        setRemixMessage(studioStatus.remixCreated(data.title));
        navigate(`/studio/pieces/${created.piece.slug}`);
      } catch (error) {
        setRemixMessage(error instanceof Error ? error.message : 'That remix could not be started.');
      }
    })();
  };

  return (
    <div className="piece-page">
      <div className="shell piece-page__layout">
        <div className="piece-page__stage">
          <EditionLens
            ref={hold.lensRef}
            slug={slug}
            fragmentSource={PUBLIC_PIECE_SHADER}
            uniforms={uniforms}
            editionCount={editionCount}
            editions={hold.editions}
            edition={edition}
            locked={hold.locked}
            onEditionChange={hold.setEdition}
            onClaim={hold.claim}
          />
        </div>

        <div className="piece-page__details">
          <h1 className="piece-page__title display">{data.title}</h1>
          <p className="piece-page__creator">{data.creator.display_name}</p>

          {data.remix_of && (
            <p className="piece-page__remix muted">
              Remix of{' '}
              <Link to={`/pieces/${data.remix_of.slug}`}>{data.remix_of.title}</Link> by{' '}
              {data.remix_of.creator_display_name}
            </p>
          )}

          <p className="piece-page__price tabular">${formatUsd(data.price_cents ?? 0)} an edition</p>
          <p className="piece-page__left muted tabular">
            {data.editions_left ?? 0} of {editionCount} editions left
          </p>
          <p className="piece-page__seed mono">{seedHash}</p>

          {canRemix && (
            <button type="button" className="ghost-button" onClick={remix}>
              Remix
            </button>
          )}

          <StatusRegion label="Checkout status" message={hold.message} />
          <StatusRegion label="Studio status" message={remixMessage} />
        </div>
      </div>

      {hold.sheet}
    </div>
  );
}
