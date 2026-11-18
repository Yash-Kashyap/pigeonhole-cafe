import { useEffect, useRef, useState } from 'react';
import OpenStatus from '../OpenStatus';
import { ownerWriteJson } from '../../lib/owner-api';
import {
  OWNER_REALTIME_EVENT,
  type RealtimeConnectionState,
} from './useOwnerRealtime';

export default function OwnerHeaderControls() {
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>('offline');
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logoutInFlight = useRef(false);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const custom = event as CustomEvent<{ state?: RealtimeConnectionState }>;
      if (custom.detail?.state) {
        setRealtimeState(custom.detail.state);
      }
    };
    window.addEventListener(OWNER_REALTIME_EVENT, onStatus);
    return () => window.removeEventListener(OWNER_REALTIME_EVENT, onStatus);
  }, []);

  const handleLogout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLoggingOut(true);
    setLogoutError(null);
    const result = await ownerWriteJson<{ signedOut?: boolean }>(
      '/api/owner/logout',
      'POST',
      {},
    );
    if (result.ok || result.status === 401) {
      window.location.assign('/owner');
      return;
    }
    logoutInFlight.current = false;
    setLoggingOut(false);
    setLogoutError(result.message);
  };

  const isLive = realtimeState === 'live';

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <div className="max-w-full">
        <OpenStatus />
      </div>
      <span
        data-realtime-pill={isLive ? 'live' : 'offline'}
        className={`inline-flex min-h-8 items-center gap-2 border px-2.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase ${
          isLive
            ? 'border-ok bg-ok/10 text-ok'
            : 'border-ink/30 bg-paper-2 text-ink-2'
        }`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`size-2 rounded-full ${isLive ? 'bg-ok' : 'bg-ink-2/60'}`}
          aria-hidden="true"
        />
        {isLive ? 'Live' : 'Offline'}
      </span>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
        className="min-h-11 border border-ink bg-card px-3.5 text-sm font-semibold text-ink transition-transform active:translate-y-px hover:bg-paper-2 disabled:opacity-60"
      >
        {loggingOut ? 'Signing out...' : 'Log out'}
      </button>
      {logoutError && (
        <span className="text-xs text-err" role="alert">
          {logoutError}
        </span>
      )}
    </div>
  );
}
