import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SOCKET_EVENTS, type OrderDto } from '@kkdm/shared';
import { Chip, PaginatedList, Screen } from '@/components/ui';
import { OrderCard } from '@/components/cards';
import { useSocketEvent } from '@/hooks';
import { api } from '@/lib/api';

const FILTERS = [
  { value: 'pending_acceptance', label: 'New' },
  { value: 'active', label: 'Active' },
  { value: 'ready', label: 'Ready' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'closed', label: 'Closed' },
  { value: 'disputed', label: 'Disputed' },
];

export default function ShopOrders() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending_acceptance');
  useSocketEvent(SOCKET_EVENTS.orderUpdated, () => void qc.invalidateQueries({ queryKey: ['shop-orders', shopId] }));
  return (
    <Screen title="Orders" scroll={false} padded={false}>
      <View className="pt-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={status === f.value} onPress={() => setStatus(f.value)} />
          ))}
        </ScrollView>
      </View>
      <PaginatedList<OrderDto>
        key={status}
        queryKey={['shop-orders', shopId, status]}
        fetchPage={(page) => api.page<OrderDto>(`/shops/${shopId}/orders`, { status, page })}
        keyOf={(o) => o.id}
        renderItem={(o) => <OrderCard order={o} sellerView onPress={() => router.push(`/seller/${shopId}/order/${o.id}`)} />}
        empty={{ title: 'No orders here', message: 'New orders appear here and you’ll get a notification.' }}
      />
    </Screen>
  );
}
