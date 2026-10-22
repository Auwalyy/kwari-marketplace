import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react-native';
import type { NotificationDto } from '@kkdm/shared';
import { IconButton, PaginatedList, Screen } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

function target(n: NotificationDto): string | null {
  const d = n.data;
  if (d.conversationId) return `/chat/${d.conversationId}`;
  if (d.quotationId) return `/quotations/${d.quotationId}`;
  if (d.orderId && d.shopId) return `/seller/${d.shopId}/order/${d.orderId}`;
  if (d.orderId) return `/orders/${d.orderId}`;
  if (d.membershipId && d.houseId) return `/house-admin/${d.houseId}/membership/${d.membershipId}`;
  if (d.houseId) return `/house-admin/${d.houseId}`;
  if (d.productId && d.shopId) return `/seller/${d.shopId}/product/${d.productId}`;
  if (d.shopId) return `/seller/${d.shopId}`;
  return null;
}

export default function Notifications() {
  const qc = useQueryClient();
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const open = async (n: NotificationDto) => {
    if (!n.read) {
      await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    const to = target(n);
    if (to) router.push(to as never);
  };
  return (
    <Screen title="Notifications" scroll={false} padded={false} right={<IconButton icon={CheckCheck} label="Mark all read" onPress={() => readAll.mutate()} />}>
      <PaginatedList<NotificationDto>
        queryKey={['notifications', 'list']}
        fetchPage={(page) => api.page<NotificationDto>('/notifications', { page })}
        keyOf={(n) => n.id}
        renderItem={(n) => (
          <Pressable onPress={() => void open(n)} className={`mb-2 flex-row rounded-2xl border p-3 ${n.read ? 'border-line bg-white' : 'border-brand-200 bg-brand-50'}`}>
            <View className="mr-3 mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-brand-100">
              <Bell size={16} color={colors.brand} />
            </View>
            <View className="flex-1">
              <View className="flex-row justify-between">
                <Text className={`flex-1 text-sm ${n.read ? 'font-medium' : 'font-bold'} text-ink-900`}>{n.title}</Text>
                <Text className="ml-2 text-xs text-ink-400">{timeAgo(n.createdAt)}</Text>
              </View>
              <Text className="mt-0.5 text-sm text-ink-600">{n.body}</Text>
            </View>
          </Pressable>
        )}
        empty={{ title: 'No notifications', message: 'Order, chat and shop updates will appear here.' }}
      />
    </Screen>
  );
}
