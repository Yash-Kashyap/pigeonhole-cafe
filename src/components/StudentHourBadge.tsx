import { useEffect, useState } from 'react';
import { isStudentHourNow } from '../lib/rules';

export default function StudentHourBadge() {
  const [active, setActive] = useState(() => isStudentHourNow(new Date()));

  useEffect(() => {
    const update = () => setActive(isStudentHourNow(new Date()));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!active) return null;

  return (
    <span
      data-student-hour-active
      className="inline-flex items-center gap-1.5 border border-ok bg-ok/10 px-2.5 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-ok uppercase"
    >
      <span className="size-2 rounded-full bg-ok" aria-hidden="true" />
      Active now
    </span>
  );
}
