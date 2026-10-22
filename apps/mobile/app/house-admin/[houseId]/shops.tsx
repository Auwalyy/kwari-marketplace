import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { HouseMembershipDto } from '@kkdm/shared';
import { Badge, Card, Chip, PaginatedList, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Members' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'removed', label: 'Removed' },
  { value: 'left', label: 'Left' },
];

/** House shop directory: membership requests and member shops. */
export default function HouseShops() {
  const params = useLocalSearchParams<{ houseId: string; status?: string }>();
  const [status, setStatus] = useState(params.status ?? 'approved');
  return (
    <Screen title="Shops in this house" scroll={false} padded={false}>
      <View className="pt-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {STATUSES.map((s) => <Chip key={s.value} label={s.label} selected={status === s.value} onPress={() => setStatus(s.value)} />)}
        </ScrollView>
      </View>
      <PaginatedList<HouseMembershipDto>
        key={status}
        queryKey={['house-memberships', params.houseId, status]}
        fetchPage={(page) => api.page<HouseMembershipDto>(`/houses/${params.houseId}/memberships`, { status, page })}
        keyOf={(m) => m.id}
        renderItem={(m) => (
          <Card className="mb-2" onPress={() => router.push(`/house-admin/${params.houseId}/membership/${m.id}`)}>
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 font-semibold text-ink-900">{m.shop.name}</Text>
              <Badge label={m.status} tone={m.status === 'approved' ? 'success' : m.status === 'pending' ? 'warning' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">Shop {m.shop.shopNumber} · {m.shop.ownerName} · requested {formatDate(m.createdAt)}</Text>
            {m.dispute && m.dispute.status !== 'resolved' ? <Badge label="Dispute open" tone="danger" className="mt-1" /> : null}
          </Card>
        )}
        empty={{ title: status === 'pending' ? 'No pending requests' : 'No shops in this list' }}
      />
    </Screen>
  );
}
