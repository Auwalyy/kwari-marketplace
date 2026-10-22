import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDto, ProductSummaryDto } from '@kkdm/shared';
import { Button, Chip, ChoiceChips, Divider, PaginatedList, Screen, SegmentedControl, Sheet, StockIndicator, TextField, toast, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatQuantity, unitLabel } from '@/lib/format';

type StaffProduct = ProductSummaryDto & { stockQuantity: number };
interface Movement { id: string; variantId: string | null; delta: number; balanceAfter: number; reason: string; note?: string; orderId: string | null; at: string }

/** Inventory: stock levels, audited adjustments and movement history. */
export default function Inventory() {
  const { shopId, productId } = useLocalSearchParams<{ shopId: string; productId?: string }>();
  const qc = useQueryClient();
  const sheet = useRef<SheetHandle>(null);
  const [filter, setFilter] = useState<'all' | 'low_stock' | 'out_of_stock'>('all');
  const [current, setCurrent] = useState<string | null>(productId ?? null);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'restock' | 'adjustment' | 'damaged'>('restock');
  const [note, setNote] = useState('');
  const [variantId, setVariantId] = useState<string | undefined>();

  const detail = useQuery({ queryKey: ['seller-product', current], queryFn: () => api.get<ProductDto>(`/shops/${shopId}/products/${current}`), enabled: !!current });
  const movements = useQuery({ queryKey: ['movements', current], queryFn: () => api.page<Movement>(`/shops/${shopId}/products/${current}/inventory`, { limit: 20 }), enabled: !!current });
  useEffect(() => {
    if (productId) sheet.current?.open();
  }, [productId]);

  const adjust = useMutation({
    mutationFn: () => api.post<ProductDto>(`/shops/${shopId}/products/${current}/inventory`, { delta: (direction === 'add' ? 1 : -1) * Number(amount), reason, note: note || undefined, variantId }),
    onSuccess: () => {
      toast.success('Stock updated');
      setAmount('');
      setNote('');
      void detail.refetch();
      void movements.refetch();
      void qc.invalidateQueries({ queryKey: ['inventory', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const open = (id: string) => {
    setCurrent(id);
    setVariantId(undefined);
    sheet.current?.open();
  };
  const p = detail.data;

  return (
    <Screen title="Inventory" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'all', label: 'All' }, { value: 'low_stock', label: 'Low' }, { value: 'out_of_stock', label: 'Out' }]} value={filter} onChange={setFilter} />
      </View>
      <PaginatedList<StaffProduct>
        key={filter}
        queryKey={['inventory', shopId, filter]}
        fetchPage={(page) => api.page<StaffProduct>(`/shops/${shopId}/products`, { stockStatus: filter === 'all' ? undefined : filter, page })}
        keyOf={(x) => x.id}
        renderItem={(x) => (
          <Pressable onPress={() => open(x.id)} className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-2.5">
            <View className="h-12 w-12 overflow-hidden rounded-lg bg-cream-200">{x.thumbnailUrl ? <Image source={{ uri: x.thumbnailUrl }} style={{ width: 48, height: 48 }} /> : null}</View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{x.name}</Text>
              <Text className="text-xs text-ink-600">{formatQuantity(x.stockQuantity, x.unit)}</Text>
            </View>
            <StockIndicator status={x.stockStatus} />
          </Pressable>
        )}
        empty={{ title: 'Nothing to show' }}
      />
      <Sheet ref={sheet} title={p?.name ?? 'Adjust stock'} snapPoints={['85%']}>
        {p ? (
          <>
            <Text className="mb-3 text-sm text-ink-600">Current stock: {formatQuantity(p.stockQuantity, p.unit)}</Text>
            {p.variants.length ? (
              <View className="mb-2 flex-row flex-wrap">
                {p.variants.map((v) => (
                  <Chip key={v.id} label={`${v.label} (${v.stockQuantity})`} selected={variantId === v.id} onPress={() => setVariantId(v.id)} />
                ))}
              </View>
            ) : null}
            <SegmentedControl options={[{ value: 'add', label: 'Add stock' }, { value: 'remove', label: 'Remove stock' }]} value={direction} onChange={(v) => { setDirection(v); setReason(v === 'add' ? 'restock' : 'adjustment'); }} />
            <TextField label={`Quantity (${unitLabel(p.unit, 2)})`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <ChoiceChips label="Reason" options={direction === 'add' ? [{ value: 'restock', label: 'Restock' }, { value: 'adjustment', label: 'Correction' }] : [{ value: 'adjustment', label: 'Correction / sold offline' }, { value: 'damaged', label: 'Damaged' }]} value={reason} onChange={(v) => v && setReason(v)} />
            <TextField label="Note (optional)" value={note} onChangeText={setNote} />
            <Button title="Save adjustment" onPress={() => adjust.mutate()} loading={adjust.isPending} disabled={!(Number(amount) > 0) || (p.variants.length > 0 && !variantId)} fullWidth />
            <Divider />
            <Text className="mb-2 font-semibold text-ink-900">History</Text>
            {movements.data?.items.map((m) => (
              <Text key={m.id} className="mb-1 text-xs text-ink-600">
                {formatDateTime(m.at)} · {m.delta > 0 ? '+' : ''}{m.delta} → {m.balanceAfter} · {m.reason.replace('_', ' ')}
                {m.note ? ` — ${m.note}` : ''}
              </Text>
            ))}
          </>
        ) : (
          <Text className="text-sm text-ink-500">Loading…</Text>
        )}
      </Sheet>
    </Screen>
  );
}
