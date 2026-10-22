import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProductSummaryDto } from '@kkdm/shared';
import { Badge, Button, PaginatedList, Screen, SegmentedControl, toast, useConfirm } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';
import { formatNaira } from '@/lib/format';

type ModProduct = ProductSummaryDto & { moderationStatus: string; moderationReason?: string };

/** Product moderation: flag, remove or restore listings. */
export default function AdminProducts() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'approved' | 'flagged' | 'removed'>('approved');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const moderate = useMutation({
    mutationFn: ({ id, moderationStatus, reason }: { id: string; moderationStatus: string; reason: string }) => api.post(`/admin/products/${id}/moderate`, { moderationStatus, reason }),
    onSuccess: () => { toast.success('Updated'); void qc.invalidateQueries({ queryKey: ['admin', 'products'] }); },
    onError: (e) => toast.apiError(e),
  });
  const run = async (p: ModProduct, to: string) => {
    const r = await confirm({ title: `${to === 'approved' ? 'Restore' : to === 'flagged' ? 'Flag' : 'Remove'} “${p.name}”?`, destructive: to === 'removed', reason: { placeholder: 'Reason (sent to the shop owner)', required: true }, confirmLabel: 'Confirm' });
    if (r.confirmed && r.reason) moderate.mutate({ id: p.id, moderationStatus: to, reason: r.reason });
  };
  return (
    <Screen title="Product moderation" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'approved', label: 'Live' }, { value: 'flagged', label: 'Flagged' }, { value: 'removed', label: 'Removed' }]} value={status} onChange={setStatus} />
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Product name" />
      </View>
      <PaginatedList<ModProduct>
        key={status + q}
        queryKey={['admin', 'products', status, q]}
        fetchPage={(page) => api.page<ModProduct>('/admin/products', { moderationStatus: status, q: q || undefined, page })}
        keyOf={(p) => p.id}
        renderItem={(p) => (
          <View className="mb-2 rounded-2xl border border-line bg-white p-3">
            <Pressable onPress={() => router.push(`/product/${p.id}`)} className="flex-row">
              <View className="h-14 w-14 overflow-hidden rounded-lg bg-cream-200">{p.thumbnailUrl ? <Image source={{ uri: p.thumbnailUrl }} style={{ width: 56, height: 56 }} /> : null}</View>
              <View className="ml-3 flex-1">
                <Text numberOfLines={1} className="font-semibold text-ink-900">{p.name}</Text>
                <Text className="text-xs text-ink-500">{p.shop.name} · {formatNaira(p.retailPriceKobo)} · {p.status}</Text>
                {p.moderationReason ? <Text className="text-xs text-danger-700">{p.moderationReason}</Text> : null}
              </View>
              <Badge label={p.moderationStatus} tone={p.moderationStatus === 'approved' ? 'success' : 'danger'} />
            </Pressable>
            <View className="mt-2 flex-row">
              {status !== 'approved' ? <Button title="Restore" size="sm" className="mr-2" onPress={() => void run(p, 'approved')} /> : null}
              {status !== 'flagged' ? <Button title="Flag" size="sm" variant="outline" className="mr-2" onPress={() => void run(p, 'flagged')} /> : null}
              {status !== 'removed' ? <Button title="Remove" size="sm" variant="ghost" onPress={() => void run(p, 'removed')} /> : null}
            </View>
          </View>
        )}
        empty={{ title: 'Nothing here' }}
      />
    </Screen>
  );
}
