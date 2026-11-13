// A select that keeps what the person picked while the server answers: a controlled select would snap back at once.
import { useEffect, useState } from 'react';

export function useChoice<T extends string>(stored: T): readonly [T, (value: T | null) => void] {
  const [chosen, choose] = useState<T | null>(null);
  useEffect(() => choose(null), [stored]);
  return [chosen ?? stored, choose];
}
