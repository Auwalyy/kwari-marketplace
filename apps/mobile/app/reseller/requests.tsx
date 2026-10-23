import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone } from 'lucide-react-native';
import type { ResellerRequestDto, ResellerRequestStatus } from '@kkdm/shared';
import { Badge, Button, Card, PaginatedList, Screen, SegmentedControl, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNaira, timeAgo, unitLabel } from '@/lib/format';

const TONE: Record<ResellerRequestStatus, 'gold' | 'info' | 'neutral' | 'success'> = { new: 'gold', accepted: 'info', declined: 'neutral', completed: 'success' };

/** Nigerian numbers in international form for WhatsApp links (0803… → 234803…). */
function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `234${digits.slice(1)}` : digits;
}

/** Customers who tapped "I want to buy" on one of the reseller's products. */
export default function ResellerRequests() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'new' | 'accepted' | 'all'>('new');
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ResellerRequestStatus }) => api.post(`/resellers/me/requests/${id}/status`, { status }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['reseller'] });
      toast.success(v.status === 'accepted' ? 'Accepted — the customer has been told' : 'Updated');
    },
    onError: (e) => toast.apiError(e),
  });

  return (
    <Screen title="Customer requests" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl
          options={[
            { value: 'new', label: 'New' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'all', label: 'All' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <PaginatedList<ResellerRequestDto>
        key={filter}
        queryKey={['reseller', 'requests', filter]}
        fetchPage={(page) => api.page<ResellerRequestDto>('/resellers/me/requests', { page, status: filter === 'all' ? undefined : filter })}
        keyOf={(r) => r.id}
        renderItem={(r) => (
          <Card className="mb-2 p-3">
            <View className="flex-row items-center">
              <View className="h-12 w-12 overflow-hidden rounded-lg bg-cream-200">{r.listing.thumbnailUrl ? <Image source={{ uri: r.listing.thumbnailUrl }} style={{ width: 48, height: 48 }} /> : null}</View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-bold text-ink-900">
                  {r.customer.fullName} · {r.quantity} {unitLabel(r.listing.unit, r.quantity)}
                </Text>
                <Text numberOfLines={1} className="text-xs text-ink-600">{r.listing.name}</Text>
                <Text className="text-xs text-ink-500">
                  {formatNaira(Math.round(r.listing.priceKobo * r.quantity))} at your price · {timeAgo(r.createdAt)}
                </Text>
              </View>
              <Badge label={r.status} tone={TONE[r.status]} />
            </View>
            {r.note ? <Text className="mt-2 text-sm text-ink-700">“{r.note}”</Text> : null}
            {r.customer.phone ? (
              <View className="mt-2 flex-row">
                <Button title="Call" icon={Phone} variant="outline" size="sm" className="mr-2" onPress={() => void Linking.openURL(`tel:${r.customer.phone}`)} />
                <Button title="WhatsApp" icon={MessageCircle} variant="outline" size="sm" onPress={() => void Linking.openURL(`https://wa.me/${waNumber(r.customer.phone!)}`)} />
              </View>
            ) : null}
            {r.status === 'new' ? (
              <View className="mt-2 flex-row">
                <Button title="Accept" size="sm" className="mr-2 flex-1" onPress={() => setStatus.mutate({ id: r.id, status: 'accepted' })} />
                <Button title="Decline" variant="outline" size="sm" className="flex-1" onPress={() => setStatus.mutate({ id: r.id, status: 'declined' })} />
              </View>
            ) : r.status === 'accepted' ? (
              <Button
                title="Record the sale"
                size="sm"
                className="mt-2"
                onPress={() =>
                  router.push({
                    pathname: '/reseller/sales',
                    params: { add: '1', requestId: r.id, listingId: r.listing.id, quantity: String(r.quantity), customerName: r.customer.fullName, customerPhone: r.customer.phone ?? '' },
                  })
                }
              />
            ) : null}
          </Card>
        )}
        empty={{ title: filter === 'new' ? 'No new requests' : 'Nothing here', message: 'When a customer taps “I want to buy” on your product, it appears here with their phone number.' }}
      />
    </Screen>
  );
}
