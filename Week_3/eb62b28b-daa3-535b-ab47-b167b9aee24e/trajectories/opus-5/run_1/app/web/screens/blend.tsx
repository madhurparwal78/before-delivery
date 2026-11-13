import { useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import { Link, Problems, focusProblems, useAnnounce, useLive, useRouter } from '../app/shell';
import { Overlay } from '../components/overlays';
import { BottomBar, Card } from '../components/pieces';
import {
  BlendView,
  INGREDIENTS,
  MemberView,
  copy,
  formatMoney,
  packetTimeLabel,
  strengthLabel,
} from '../app/types';

interface Item {
  ingredient: string;
  capsulesPerDay: number;
}

export function BlendBuilderScreen({
  memberId,
  blendId,
}: {
  memberId: string;
  blendId?: string;
}): JSX.Element {
  const { announce } = useAnnounce();
  const { navigate } = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [preview, setPreview] = useState<BlendView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  const catalogButton = useRef<HTMLButtonElement | null>(null);

  const { data: member } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}`);
    return result.data?.member ?? null;
  }, [memberId]);
  const { data: blends } = useLive<BlendView[]>(async () => {
    const result = await api<{ blends: BlendView[] }>(`/api/members/${memberId}/blends`);
    return result.data?.blends ?? null;
  }, [memberId]);

  useEffect(() => {
    if (loaded.current || !blends) return;
    loaded.current = true;
    const source = blendId
      ? blends.find((entry) => entry.id === blendId) ?? blends[0]
      : blends[0];
    if (source) {
      setItems(
        source.items.map((item) => ({
          ingredient: item.ingredient,
          capsulesPerDay: item.capsulesPerDay,
        })),
      );
    }
  }, [blends, blendId]);

  useEffect(() => {
    if (items.length === 0) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const run = async (): Promise<void> => {
        const result = await api<{ blend: BlendView }>(
          `/api/members/${memberId}/blends/preview`,
          { method: 'POST', json: { items } },
        );
        if (result.error) {
          setProblem(result.error.message);
          announce(result.error.message);
          return;
        }
        setProblem(null);
        setPreview(result.data?.blend ?? null);
      };
      void run();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [items, memberId, announce]);

  const add = (ingredient: string): void => {
    setItems((current) =>
      current.some((item) => item.ingredient === ingredient)
        ? current
        : [...current, { ingredient, capsulesPerDay: 1 }],
    );
    if (sheetOpen) setSheetOpen(false);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api<{ blend: BlendView }>(`/api/members/${memberId}/blends`, {
      method: 'POST',
      json: { items },
    });
    setBusy(false);
    if (result.error) {
      setProblem(result.error.message);
      announce(result.error.message);
      focusProblems();
      return;
    }
    setProblem(null);
    announce(copy.blendSaved);
    const saved = result.data?.blend;
    if (saved?.id) navigate(`/staff/members/${memberId}/blends/${saved.id}`);
  };

  const catalog = (
    <div role="region" aria-label="Ingredient catalog">
      <h2>Ingredient catalog</h2>
      <ul className="packet-list">
        {INGREDIENTS.map((ingredient) => (
          <li key={ingredient.id}>
            <span>
              {ingredient.name} <span className="muted">{strengthLabel(ingredient)}</span>{' '}
              <span className="muted">{packetTimeLabel[ingredient.time]}</span>{' '}
              <span className="muted">{formatMoney(ingredient.priceCentsPerCapsule)} a capsule</span>
            </span>
            <button type="button" className="quiet" onClick={() => add(ingredient.id)}>
              Add {ingredient.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const packet = (time: 'morning' | 'evening'): JSX.Element => {
    const label = time === 'morning' ? 'Morning packet' : 'Evening packet';
    const count = time === 'morning' ? preview?.morningCapsules ?? 0 : preview?.eveningCapsules ?? 0;
    const rows = (preview?.items ?? []).filter((item) =>
      time === 'morning' ? item.morning > 0 : item.evening > 0,
    );
    return (
      <Card>
        <div role="region" aria-label={label}>
          <h2>{label}</h2>
          <p>{count} of 4 capsules</p>
          <ul className="packet-list">
            {rows.map((item) => {
              const ingredient = INGREDIENTS.find((entry) => entry.id === item.ingredient);
              const current = items.find((entry) => entry.ingredient === item.ingredient);
              return (
                <li key={item.ingredient}>
                  <span>
                    {ingredient?.name} <span className="muted">{ingredient ? strengthLabel(ingredient) : ''}</span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Capsules a day, ${ingredient?.name ?? item.ingredient}`}
                    value={current?.capsulesPerDay ?? item.capsulesPerDay}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setItems((currentItems) =>
                        currentItems.map((entry) =>
                          entry.ingredient === item.ingredient
                            ? { ...entry, capsulesPerDay: Number.isFinite(next) ? next : 1 }
                            : entry,
                        ),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      setItems((currentItems) =>
                        currentItems.filter((entry) => entry.ingredient !== item.ingredient),
                      )
                    }
                  >
                    Remove {ingredient?.name ?? item.ingredient}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>
    );
  };

  return (
    <>
      <h1 tabIndex={-1}>Blend for {member?.name ?? ''}</h1>
      <Problems message={problem} />
      <button
        type="button"
        className="quiet narrow-only"
        ref={catalogButton}
        onClick={() => setSheetOpen(true)}
      >
        Ingredient catalog
      </button>
      <div className="blend-layout">
        <Card className="wide-only">{catalog}</Card>
        <div>
          <div className="packets">
            {packet('morning')}
            {packet('evening')}
          </div>
          <Card>
            <p>30-day list price {formatMoney(preview?.listPriceCents ?? 0)}</p>
            <p>Member price {formatMoney(preview?.memberPriceCents ?? 0)}</p>
          </Card>
        </div>
      </div>
      <Overlay
        name="Ingredient catalog"
        kind="sheet"
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        opener={catalogButton}
      >
        {catalog}
        <button type="button" className="quiet" onClick={() => setSheetOpen(false)}>
          Close
        </button>
      </Overlay>
      <p>
        <Link to={`/staff/members/${memberId}`}>Back to member</Link>
      </p>
      <BottomBar>
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save blend
        </button>
      </BottomBar>
    </>
  );
}
