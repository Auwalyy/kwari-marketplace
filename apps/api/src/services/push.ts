import { env } from '../config/env';
import { logger } from '../config/logger';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  channelId?: string;
}

export interface PushTicket {
  token: string;
  status: 'ok' | 'error';
  id?: string;
  error?: string;
  /** True when the token is permanently invalid and should be deactivated. */
  deviceNotRegistered?: boolean;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function isExpoPushToken(token: string) {
  return /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token);
}

export function pushEnabled() {
  return env.PUSH_NOTIFICATION_ENABLED;
}

/** Sends messages through the Expo push service in batches of 100, with a timeout per request. */
export async function sendExpoPush(messages: PushMessage[]): Promise<PushTicket[]> {
  if (!pushEnabled() || messages.length === 0) return [];
  const tickets: PushTicket[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({ sound: 'default', channelId: 'default', ...m }))),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }[] };
      (json.data ?? []).forEach((t, idx) =>
        tickets.push({
          token: chunk[idx].to,
          status: t.status,
          id: t.id,
          error: t.message,
          deviceNotRegistered: t.details?.error === 'DeviceNotRegistered',
        }),
      );
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Expo push request failed');
      chunk.forEach((m) => tickets.push({ token: m.to, status: 'error', error: (err as Error).message }));
    } finally {
      clearTimeout(timer);
    }
  }
  return tickets;
}
