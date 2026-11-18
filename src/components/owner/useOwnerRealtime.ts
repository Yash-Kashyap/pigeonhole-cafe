import { useEffect, useRef, useState } from 'react';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { ownerGetJson } from '../../lib/owner-api';

export type RealtimeTable = 'orders' | 'order_items' | 'bookings' | 'enquiries';
export type RealtimeConnectionState = 'connecting' | 'live' | 'offline';

export const OWNER_REALTIME_EVENT = 'ph-owner-realtime-status';

type RealtimeTokenPayload = {
  accessToken: string;
  expiresAt: string;
};

type UseOwnerRealtimeOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  tables: readonly RealtimeTable[];
  onTableChange: (
    table: RealtimeTable,
    eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  ) => void;
  onReconnect: () => void;
  onFallbackPoll: () => void;
};

const PRIMARY_TABLES = new Set<RealtimeTable>([
  'orders',
  'bookings',
  'enquiries',
]);
const POLL_INTERVAL_MS = 10_000;
const MAX_TOKEN_REFRESH_MS = 45 * 60 * 1000;
const MIN_TOKEN_REFRESH_MS = 30 * 1000;
const RECONNECT_RETRY_MS = 15_000;

function broadcastRealtimeState(state: RealtimeConnectionState) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<{ state: RealtimeConnectionState }>(OWNER_REALTIME_EVENT, {
      detail: { state },
    }),
  );
}

export function useOwnerRealtime(
  options: UseOwnerRealtimeOptions,
): RealtimeConnectionState {
  const { supabaseUrl, supabaseAnonKey, tables } = options;
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>('connecting');

  const onTableChangeRef = useRef(options.onTableChange);
  const onReconnectRef = useRef(options.onReconnect);
  const onFallbackPollRef = useRef(options.onFallbackPoll);

  useEffect(() => {
    onTableChangeRef.current = options.onTableChange;
    onReconnectRef.current = options.onReconnect;
    onFallbackPollRef.current = options.onFallbackPoll;
  }, [options.onTableChange, options.onReconnect, options.onFallbackPoll]);

  const tablesKey = tables.join(',');

  useEffect(() => {
    let disposed = false;
    let client: SupabaseClient | null = null;
    let channels: RealtimeChannel[] = [];
    let refreshTimer: number | null = null;
    let retryTimer: number | null = null;
    let hasConnectedOnce = false;
    let currentState: RealtimeConnectionState = 'connecting';
    const primaryStates = new Map<RealtimeTable, boolean>();

    const activeTables = tablesKey
      .split(',')
      .filter((entry): entry is RealtimeTable => Boolean(entry));

    for (const table of activeTables) {
      if (PRIMARY_TABLES.has(table)) {
        primaryStates.set(table, false);
      }
    }

    const updateState = (next: RealtimeConnectionState) => {
      if (disposed || currentState === next) return;
      const wasOfflineOrDisconnected =
        hasConnectedOnce && currentState !== 'live' && next === 'live';
      currentState = next;
      setConnectionState(next);
      broadcastRealtimeState(next);
      if (next === 'live') {
        hasConnectedOnce = true;
      }
      if (wasOfflineOrDisconnected) {
        onReconnectRef.current();
      }
    };

    broadcastRealtimeState('connecting');

    if (!supabaseUrl || !supabaseAnonKey || activeTables.length === 0) {
      updateState('offline');
      return () => {
        disposed = true;
      };
    }

    const clearTimers = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const cleanupClient = async () => {
      clearTimers();
      const activeClient = client;
      const activeChannels = channels;
      client = null;
      channels = [];
      if (activeClient) {
        for (const channel of activeChannels) {
          try {
            await activeClient.removeChannel(channel);
          } catch {
            // Ignore teardown errors when leaving the page.
          }
        }
      }
    };

    const scheduleTokenRefresh = (expiresAtIso: string) => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      const expiresAtMs = Date.parse(expiresAtIso);
      const untilExpiry = Number.isFinite(expiresAtMs)
        ? expiresAtMs - Date.now() - 120_000
        : MAX_TOKEN_REFRESH_MS;
      const delay = Math.max(
        MIN_TOKEN_REFRESH_MS,
        Math.min(MAX_TOKEN_REFRESH_MS, untilExpiry),
      );
      refreshTimer = window.setTimeout(() => {
        void refreshAuthToken();
      }, delay);
    };

    const refreshAuthToken = async (): Promise<boolean> => {
      if (disposed) return false;
      const tokenResult = await ownerGetJson<RealtimeTokenPayload>(
        '/api/owner/realtime-token',
      );
      if (disposed) return false;
      if (!tokenResult.ok || !tokenResult.data.accessToken) {
        updateState('offline');
        return false;
      }
      // Keep the token only inside this closure and hand it straight to Realtime.
      if (client) {
        await client.realtime.setAuth(tokenResult.data.accessToken);
      }
      scheduleTokenRefresh(tokenResult.data.expiresAt);
      return true;
    };

    const scheduleReconnect = () => {
      if (disposed || retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void connect();
      }, RECONNECT_RETRY_MS);
    };

    const connect = async () => {
      await cleanupClient();
      if (disposed) return;

      const tokenResult = await ownerGetJson<RealtimeTokenPayload>(
        '/api/owner/realtime-token',
      );
      if (disposed) return;
      if (!tokenResult.ok || !tokenResult.data.accessToken) {
        updateState('offline');
        scheduleReconnect();
        return;
      }

      const nextClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      client = nextClient;

      await nextClient.realtime.setAuth(tokenResult.data.accessToken);
      if (disposed) {
        await cleanupClient();
        return;
      }
      scheduleTokenRefresh(tokenResult.data.expiresAt);

      for (const table of activeTables) {
        const channel = nextClient
          .channel(`owner-${table}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table },
            (payload) => {
              if (disposed) return;
              const eventType =
                payload.eventType === 'INSERT' ||
                payload.eventType === 'UPDATE' ||
                payload.eventType === 'DELETE'
                  ? payload.eventType
                  : 'UPDATE';
              onTableChangeRef.current(table, eventType);
            },
          )
          .subscribe((status) => {
            if (disposed) return;
            if (PRIMARY_TABLES.has(table)) {
              primaryStates.set(table, status === 'SUBSCRIBED');
              const anyPrimaryLive = [...primaryStates.values()].some(Boolean);
              if (anyPrimaryLive) {
                updateState('live');
              } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
              ) {
                updateState('offline');
                scheduleReconnect();
              }
            }
          });
        channels.push(channel);
      }
    };

    void connect();

    return () => {
      disposed = true;
      void cleanupClient();
    };
  }, [supabaseUrl, supabaseAnonKey, tablesKey]);

  useEffect(() => {
    if (connectionState === 'live') return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        onFallbackPollRef.current();
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(poll);
  }, [connectionState]);

  return connectionState;
}
