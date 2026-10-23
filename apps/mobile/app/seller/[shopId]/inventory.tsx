import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react-native';
import type { ProductDto, StockForecastDto } from '@kkdm/shared';
import { Button, Chip, ChoiceChips, Divider, EmptyState, ErrorState, ListSkeleton, Screen, SegmentedControl, Sheet, StockIndicator, SwitchRow, TextField, toast, type SheetHandle } from '@/components/ui';
import { useStaffShop } from '@/components/seller';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity, koboToNairaInput, nairaInputToKobo, unitLabel } from '@/lib/format';

interface Movement { id: string; variantId: string | null; delta: number; balanceAfter: number; reason: string; note?: string; orderId: string | null; at: string }

const REASON_LABELS: Record<string, string> = {
  initial: 'Starting stock',
  restock: 'Restock',
  adjustment: 'Correction',
  damaged: 'Damaged',
  order_reserved: 'App order',
  order_released: 'App order cancelled',
  sale_in_shop: 'Sold in shop',
  sale_voided: 'Shop sale cancelled',
};

/** "About 5 days left" in words a trader uses, coloured by urgency. */
function DaysLeft({ f }: { f: StockForecastDto }) {
  if (f.stockQuantity <= 0) return <Text className="text-xs font-semibold text-danger-500">Sold out</Text>;
  if (f.daysLeft == null) return <Text className="text-xs text-ink-400">No sales in 30 days</Text>;
  const color = f.daysLeft <= 3 ? 'text-danger-500' : f.daysLeft <= 7 ? 'text-warning-500' : 'text-brand-700';
  const text = f.daysLeft === 0 ? 'Less than a day left' : f.daysLeft > 90 ? 'Over 3 months left' : `About ${f.daysLeft} day${f.daysLeft === 1 ? '' : 's'} left`;
  return <Text className={`text-xs font-semibold ${color}`}>{text}</Text>;
}

/** Inventory: what is on the shelf, how long it will last at the current selling rate, and audited changes. */
export default function Inventory() {
  const { shopId, productId } = useLocalSearchParams<{ shopId: string; productId?: string }>();
  const qc = useQueryClient();
  const shop = useStaffShop(shopId);
  const sheet = useRef<SheetHandle>(null);
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<string | null>(productId ?? null);
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'restock' | 'adjustment' | 'damaged'>('restock');
  const [unitCost, setUnitCost] = useState('');
  const [asExpense, setAsExpense] = useState(true);
  const [note, setNote] = useState('');
  const [variantId, setVariantId] = useState<string | undefined>();

  const forecast = useQuery({ queryKey: ['inventory', shopId, 'forecast'], queryFn: () => api.get<StockForecastDto[]>(`/shops/${shopId}/books/forecast`) });
  const detail = useQuery({ queryKey: ['seller-product', current], queryFn: () => api.get<ProductDto>(`/shops/${shopId}/products/${current}`), enabled: !!current });
  const movements = useQuery({ queryKey: ['movements', current], queryFn: () => api.page<Movement>(`/shops/${shopId}/products/${current}/inventory`, { limit: 20 }), enabled: !!current });
  useEffect(() => {
    if (productId) sheet.current?.open();
  }, [productId]);

  const rows = useMemo(() => {
    const all = forecast.data ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((f) => {
      if (term && !f.name.toLowerCase().includes(term)) return false;
      if (filter === 'out') return f.stockQuantity <= 0;
      if (filter === 'low') return f.stockQuantity > 0 && (f.stockStatus === 'low_stock' || (f.daysLeft != null && f.daysLeft <= 7));
      return true;
    });
  }, [forecast.data, filter, search]);
  const lowCount = (forecast.data ?? []).filter((f) => f.stockQuantity > 0 && (f.stockStatus === 'low_stock' || (f.daysLeft != null && f.daysLeft <= 7))).length;
  const outCount = (forecast.data ?? []).filter((f) => f.stockQuantity <= 0).length;

  const isRestock = direction === 'add' && reason === 'restock';
  const costKobo = nairaInputToKobo(unitCost);
  const adjust = useMutation({
    mutationFn: () =>
      api.post<ProductDto>(`/shops/${shopId}/products/${current}/inventory`, {
        delta: (direction === 'add' ? 1 : -1) * Number(amount),
        reason,
        note: note || undefined,
        variantId,
        ...(shop.finance && isRestock && costKobo != null ? { unitCostKobo: costKobo, recordExpense: asExpense } : {}),
      }),
    onSuccess: () => {
      toast.success(isRestock && shop.finance && costKobo != null && asExpense ? 'Stock added and recorded as an expense' : 'Stock updated');
      setAmount('');
      setNote('');
      setUnitCost('');
      void detail.refetch();
      void movements.refetch();
      void qc.invalidateQueries({ queryKey: ['inventory', shopId] });
      void qc.invalidateQueries({ queryKey: ['books', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const open = (id: string) => {
    setCurrent(id);
    setVariantId(undefined);
    setDirection('add');
    setReason('restock');
    sheet.current?.open();
  };
  const p = detail.data;
  const f = forecast.data?.find((x) => x.productId === current);

  return (
    <Screen title="Inventory" subtitle="Stock and how long it will last" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <TextField icon={Search} placeholder="Search products" value={search} onChangeText={setSearch} containerClassName="mb-3" autoCorrect={false} />
        <SegmentedControl
          options={[
            { value: 'all', label: 'All' },
            { value: 'low', label: `Running low${lowCount ? ` (${lowCount})` : ''}` },
            { value: 'out', label: `Sold out${outCount ? ` (${outCount})` : ''}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      {forecast.isPending ? (
        <ListSkeleton />
      ) : forecast.isError ? (
        <ErrorState error={forecast.error} onRetry={() => forecast.refetch()} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(x) => x.productId}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={forecast.isRefetching} onRefresh={() => void forecast.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<EmptyState title={filter === 'all' ? 'No products with stock tracking' : 'Nothing here'} message={filter === 'all' ? 'Add products to start tracking stock.' : 'Good — nothing is running out.'} />}
          renderItem={({ item: x }) => (
            <Pressable onPress={() => open(x.productId)} className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-2.5 active:bg-cream-50">
              <View className="h-12 w-12 overflow-hidden rounded-lg bg-cream-200">{x.thumbnailUrl ? <Image source={{ uri: x.thumbnailUrl }} style={{ width: 48, height: 48 }} /> : null}</View>
              <View className="ml-3 flex-1">
                <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{x.name}</Text>
                <Text className="text-xs text-ink-600">
                  {formatQuantity(x.stockQuantity, x.unit)} · sold {formatQuantity(x.soldLast30, x.unit)} in 30 days
                </Text>
                <DaysLeft f={x} />
              </View>
              {x.suggestedReorder > 0 && (x.daysLeft ?? 99) <= 7 ? (
                <View className="items-end">
                  <Text className="text-[10px] text-ink-500">Buy about</Text>
                  <Text className="text-sm font-bold text-ink-900">{formatQuantity(x.suggestedReorder, x.unit)}</Text>
                </View>
              ) : (
                <StockIndicator status={x.stockStatus} />
              )}
            </Pressable>
          )}
        />
      )}
      <Sheet ref={sheet} title={p?.name ?? 'Change stock'} snapPoints={['90%']}>
        {p ? (
          <>
            <Text className="text-sm text-ink-700">On the shelf: <Text className="font-bold">{formatQuantity(p.stockQuantity, p.unit)}</Text></Text>
            {f ? (
              <View className="mb-3 mt-1">
                <DaysLeft f={f} />
                {f.dailyRate > 0 ? (
                  <Text className="text-xs text-ink-500">
                    Sells about {formatQuantity(f.dailyRate, p.unit)} a day{f.suggestedReorder > 0 ? ` · buy about ${formatQuantity(f.suggestedReorder, p.unit)} to last a month` : ''}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {p.variants.length ? (
              <View className="mb-2 flex-row flex-wrap">
                {p.variants.map((v) => (
                  <Chip key={v.id} label={`${v.label} (${v.stockQuantity})`} selected={variantId === v.id} onPress={() => setVariantId(v.id)} />
                ))}
              </View>
            ) : null}
            <SegmentedControl
              options={[
                { value: 'add', label: 'Add stock' },
                { value: 'remove', label: 'Remove stock' },
              ]}
              value={direction}
              onChange={(v) => {
                setDirection(v);
                setReason(v === 'add' ? 'restock' : 'adjustment');
              }}
            />
            <TextField label={`How many ${unitLabel(p.unit, 2)}`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            <ChoiceChips
              label="Reason"
              options={direction === 'add' ? [{ value: 'restock', label: 'New stock bought' }, { value: 'adjustment', label: 'Correction' }] : [{ value: 'adjustment', label: 'Correction / count' }, { value: 'damaged', label: 'Damaged' }]}
              value={reason}
              onChange={(v) => v && setReason(v)}
            />
            {direction === 'remove' ? <Text className="-mt-2 mb-3 text-xs text-ink-500">Sold something in the shop? Use “Record a sale” instead — it takes the stock and counts the money.</Text> : null}
            {shop.finance && isRestock ? (
              <>
                <TextField
                  label={`What each ${unitLabel(p.unit)} cost you (₦)`}
                  keyboardType="numeric"
                  value={unitCost}
                  onChangeText={setUnitCost}
                  placeholder={p.costPriceKobo != null ? koboToNairaInput(p.costPriceKobo) : 'optional'}
                  hint={costKobo != null && Number(amount) > 0 ? `Total ${formatNaira(Math.round(costKobo * Number(amount)))} · keeps your profit exact` : 'Keeps your profit per product exact'}
                />
                {costKobo != null ? <SwitchRow label="Also record as an expense" description="Adds it to Expenses as “Buying stock”" value={asExpense} onChange={setAsExpense} /> : null}
              </>
            ) : null}
            <TextField label="Note (optional)" value={note} onChangeText={setNote} />
            <Button title="Save" onPress={() => adjust.mutate()} loading={adjust.isPending} disabled={!(Number(amount) > 0) || (p.variants.length > 0 && !variantId)} fullWidth />
            <Divider />
            <Text className="mb-2 font-semibold text-ink-900">History</Text>
            {movements.data?.items.map((m) => (
              <View key={m.id} className="mb-1.5 flex-row justify-between">
                <Text className="flex-1 text-xs text-ink-600">
                  {formatDateTime(m.at)} · {REASON_LABELS[m.reason] ?? m.reason}
                  {m.note ? ` — ${m.note}` : ''}
                </Text>
                <Text className={`ml-2 text-xs font-semibold ${m.delta > 0 ? 'text-brand-700' : 'text-ink-800'}`}>
                  {m.delta > 0 ? '+' : ''}
                  {m.delta} → {m.balanceAfter}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <Text className="text-sm text-ink-500">Loading…</Text>
        )}
      </Sheet>
    </Screen>
  );
}
