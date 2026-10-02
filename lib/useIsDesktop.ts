import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** True on laptop/desktop widths. Phones and small tablets get the mobile layout. */
export function useIsDesktop(): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return matches;
}
