import { useEffect, useState } from 'react';
import type { Clay, Piece, User } from '../../shared/types';
import { api } from '../api';
import { PieceForm } from '../components/PieceForm';
import type { LiveMessage } from '../components/bits';

export function IntakeScreen(): JSX.Element {
  const [clays, setClays] = useState<Clay[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [phone, setPhone] = useState(() => window.innerWidth < 600);

  useEffect(() => {
    void api.get<Clay[]>('/api/clays').then(setClays);
    void api.get<User>('/api/me').then(setMe);
    const listener = (): void => setPhone(window.innerWidth < 600);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);

  const submit = async (payload: unknown, key: string): Promise<LiveMessage> => {
    const piece = await api.post<Piece>('/api/intakes', payload, { 'Idempotency-Key': key });
    return {
      text: `Piece ${piece.number} accepted. Receipt sent to ${me?.email ?? ''}.`,
      tone: 'good',
    };
  };

  return (
    <section>
      <h1>Log a piece</h1>
      <PieceForm
        clays={clays}
        submitLabel="Accept and charge"
        resultName="Intake result"
        pendingText="Saving photo, charge and receipt…"
        pinFeePanel={phone}
        onSubmit={submit}
      />
    </section>
  );
}
