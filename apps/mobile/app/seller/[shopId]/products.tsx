import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Plus, Square } from 'lucide-react-native';
import type { ProductSummaryDto } from '@kkdm/shared';
import { Badge, Button, PaginatedList, Screen, SegmentedControl, StockIndicator, toast } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatNaira, unitLabel } from '@/lib/format';

type StaffProduct = ProductSummaryDto & { stockQuantity: number; moderationStatus: string; imageCount: number };

export default function SellerProducts() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'published' | 'draft' | 'archived'>('published');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulk = useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'archive') => api.post<{ results: { ok: boolean; error?: string }[] }>(`/shops/${shopId}/products/bulk`, { productIds: [...selected], action }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast.error(`${failed.length} item(s) could not be updated: ${failed[0].error}`);
      else toast.success('Updated');
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['seller-products', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <Screen
      title="Products"
      scroll={false}
      padded={false}
      footer={
        selected.size ? (
          <View className="flex-row">
            {status !== 'published' ? <Button title={`Publish (${selected.size})`} size="sm" className="mr-2 flex-1" onPress={() => bulk.mutate('publish')} loading={bulk.isPending} /> : null}
            {status === 'published' ? <Button title="Unpublish" size="sm" variant="outline" className="mr-2 flex-1" onPress={() => bulk.mutate('unpublish')} /> : null}
            {status !== 'archived' ? <Button title="Archive" size="sm" variant="outline" className="flex-1" onPress={() => bulk.mutate('archive')} /> : null}
          </View>
        ) : (
          <Button title="Add product" icon={Plus} onPress={() => router.push(`/seller/${shopId}/product/new`)} fullWidth />
        )
      }
    >
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'archived', label: 'Archived' }]} value={status} onChange={(v) => { setStatus(v); setSelected(new Set()); }} />
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Search your products" />
      </View>
      <PaginatedList<StaffProduct>
        key={status + q}
        queryKey={['seller-products', shopId, status, q]}
        fetchPage={(page) => api.page<StaffProduct>(`/shops/${shopId}/products`, { status, q: q || undefined, page })}
        keyOf={(p) => p.id}
        renderItem={(p) => (
          <Pressable onPress={() => router.push(`/seller/${shopId}/product/${p.id}`)} onLongPress={() => toggle(p.id)} className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-2.5">
            <Pressable onPress={() => toggle(p.id)} hitSlop={8} className="mr-2" accessibilityLabel="Select">
              {selected.has(p.id) ? <CheckSquare size={20} color={colors.brand} /> : <Square size={20} color={colors.inkFaint} />}
            </Pressable>
            <View className="h-14 w-14 overflow-hidden rounded-lg bg-cream-200">{p.thumbnailUrl ? <Image source={{ uri: p.thumbnailUrl }} style={{ width: 56, height: 56 }} /> : null}</View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{p.name}</Text>
              <Text className="text-xs text-ink-600">{formatNaira(p.retailPriceKobo)} / {unitLabel(p.unit)} · {p.stockQuantity} in stock</Text>
              <View className="mt-1 flex-row flex-wrap">
                <StockIndicator status={p.stockStatus} />
                {p.moderationStatus !== 'approved' ? <Badge label={`Moderation: ${p.moderationStatus}`} tone="danger" className="ml-1" /> : null}
                {!p.imageCount ? <Badge label="No photos" tone="warning" className="ml-1" /> : null}
              </View>
            </View>
          </Pressable>
        )}
        empty={{ title: status === 'draft' ? 'No drafts' : status === 'archived' ? 'Nothing archived' : 'No published products', message: 'Add products with clear photos so customers can find them by image.', action: 'Add product', onAction: () => router.push(`/seller/${shopId}/product/new`) }}
      />
    </Screen>
  );
}
