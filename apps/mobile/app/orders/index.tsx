import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { OrderDto } from '@kkdm/shared';
import { PaginatedList, Screen, SegmentedControl } from '@/components/ui';
import { OrderCard } from '@/components/cards';
import { api } from '@/lib/api';

export default function Orders() {
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  return (
    <Screen title="My orders" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Past' }]} value={tab} onChange={setTab} />
      </View>
      <PaginatedList<OrderDto>
        key={tab}
        queryKey={['orders', tab]}
        fetchPage={(page) => api.page<OrderDto>('/orders', { status: tab, page })}
        keyOf={(o) => o.id}
        renderItem={(o) => <OrderCard order={o} onPress={() => router.push(`/orders/${o.id}`)} />}
        empty={{ title: tab === 'active' ? 'No active orders' : 'No past orders', message: 'Orders you place will appear here.', action: 'Browse the market', onAction: () => router.push('/(tabs)') }}
      />
    </Screen>
  );
}
