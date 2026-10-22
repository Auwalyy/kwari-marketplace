import { useCallback, useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SOCKET_EVENTS, type ShopPermission } from '@kkdm/shared';
import { api } from '@/lib/api';
import { onSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { toast } from '@/components/ui';

export interface AppConfig {
  currency: string;
  timezone: string;
  features: {
    visualSearch: { available: boolean; provider: string | null; developmentOnly: boolean };
    onlinePayment: { available: boolean; provider: string | null };
    pushNotifications: boolean;
    maps: boolean;
  };
}

/** Server-reported availability of optional services (visual search, online payment, push). */
export function useAppConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/config'), staleTime: 5 * 60_000 });
}

/** Returns a function that runs `action` if signed in, otherwise sends the user to log in first. */
export function useRequireAuth() {
  const status = useAuth((s) => s.status);
  const pathname = usePathname();
  return useCallback(
    (action?: () => void, message = 'Sign in to continue') => {
      if (status === 'authenticated') {
        action?.();
        return true;
      }
      toast.info(message);
      router.push({ pathname: '/(auth)/login', params: { next: pathname } });
      return false;
    },
    [status, pathname],
  );
}

export function useFavourites() {
  const authed = useAuth((s) => s.status === 'authenticated');
  const qc = useQueryClient();
  const requireAuth = useRequireAuth();
  const q = useQuery({
    queryKey: ['favorites', 'ids'],
    queryFn: () => api.get<{ products: string[]; shops: string[] }>('/favorites/ids'),
    enabled: authed,
  });
  const mutation = useMutation({
    mutationFn: async ({ type, id, saved }: { type: 'product' | 'shop'; id: string; saved: boolean }) =>
      saved ? api.del(`/favorites/${type}/${id}`) : api.post('/favorites', { targetType: type, targetId: id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: (e) => toast.apiError(e),
  });
  const products = new Set(q.data?.products ?? []);
  const shops = new Set(q.data?.shops ?? []);
  return {
    products,
    shops,
    toggle: (type: 'product' | 'shop', id: string) =>
      requireAuth(() => mutation.mutate({ type, id, saved: (type === 'product' ? products : shops).has(id) }), 'Sign in to save favourites'),
  };
}

export function useUnreadCounts() {
  const authed = useAuth((s) => s.status === 'authenticated');
  const qc = useQueryClient();
  const notifications = useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'), enabled: authed, refetchInterval: 60_000 });
  const chats = useQuery({ queryKey: ['conversations', 'unread'], queryFn: () => api.get<{ customer: number; shops: Record<string, number> }>('/conversations/unread-count'), enabled: authed, refetchInterval: 60_000 });
  useEffect(() => {
    if (!authed) return;
    const offs = [
      onSocket(SOCKET_EVENTS.notificationNew, () => void qc.invalidateQueries({ queryKey: ['notifications'] })),
      onSocket(SOCKET_EVENTS.messageNew, () => {
        void qc.invalidateQueries({ queryKey: ['conversations'] });
      }),
      onSocket(SOCKET_EVENTS.orderUpdated, () => {
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['shop-orders'] });
      }),
      onSocket(SOCKET_EVENTS.quotationUpdated, () => void qc.invalidateQueries({ queryKey: ['quotations'] })),
    ];
    return () => offs.forEach((o) => o());
  }, [authed, qc]);
  const shopsTotal = Object.values(chats.data?.shops ?? {}).reduce((a, b) => a + b, 0);
  return { notifications: notifications.data?.unread ?? 0, customerChats: chats.data?.customer ?? 0, shopChats: chats.data?.shops ?? {}, shopChatsTotal: shopsTotal };
}

export function useSocketEvent(event: string, handler: (payload: any) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return onSocket(event, handler);
  }, [event, handler, enabled]);
}

/** The signed-in user's membership in a shop, resolved from /users/me (server-side roles). */
export function useShopRole(shopId?: string) {
  const user = useAuth((s) => s.user);
  const m = user?.shops.find((s) => s.shopId === shopId);
  const can = (p: ShopPermission | 'owner') => !!m && (m.role === 'owner' || (p !== 'owner' && m.permissions.includes(p)));
  return { membership: m, isOwner: m?.role === 'owner', can };
}
