import { useEffect, useState } from 'react';
import { getOpenState } from '../lib/rules';

export default function OpenStatus() {
  const [label, setLabel] = useState(() => getOpenState(new Date()).label);
  useEffect(() => {
    const update = () => setLabel(getOpenState(new Date()).label);
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="inline-flex min-h-8 items-center gap-2 xl:shrink-0 xl:whitespace-nowrap border border-ink/25 px-3 font-mono text-[11px] tracking-[0.06em] uppercase">
      <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
      {label}
    </span>
  );
}
