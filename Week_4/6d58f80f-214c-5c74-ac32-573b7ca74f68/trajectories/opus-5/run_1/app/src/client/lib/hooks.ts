import { useEffect, useState } from 'react';
import { readAddress, type Address } from './address.js';

export const useAddress = (): Address => {
  const [address, setAddress] = useState<Address>(() => readAddress());
  useEffect(() => {
    const update = (): void => setAddress(readAddress());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return address;
};

export type Viewport = 'phone' | 'tablet' | 'desktop';

const widthOf = (): Viewport => {
  if (window.innerWidth < 768) return 'phone';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
};

export const useViewport = (): Viewport => {
  const [viewport, setViewport] = useState<Viewport>(() => widthOf());
  useEffect(() => {
    const update = (): void => setViewport(widthOf());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
};
