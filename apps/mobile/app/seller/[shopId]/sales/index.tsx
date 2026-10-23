import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import type { BooksPeriod, ShopSaleDto } from '@kkdm/shared';
import { Badge, Button, Chip, PaginatedList, Screen } from '@/components/ui';
import { useStaffShop } from '@/components/seller';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity } from '@/lib/format';

type Filter = BooksPeriod | 'all' | 'owing';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All' },
  { value: 'owing', label: 'Owing' },
];

/** The sales book: sales made in the shop, with credit sales easy to find. */
export default function SalesBook() {
  const params = useLocalSearchParams<{ shopId: string; owing?: string }>();
  const shopId = params.shopId;
  const shop = useStaffShop(shopId);
  const [filter, setFilter] = useState<Filter>(params.owing ? 'owing' : 'today');

  return (
    <Screen
      title="Sales book"
      subtitle="Sales made in the shop"
      scroll={false}
      padded={false}
      footer={shop.can('sales.record') ? <Button title="Record a sale" icon={Plus} size="lg" fullWidth onPress={() => router.push(`/seller/${shopId}/sales/new` as never)} /> : undefined}
    >
      <View className="pt-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ScrollView>
      </View>
      <PaginatedList<ShopSaleDto>
        key={filter}
        queryKey={['books', shopId, 'sales', filter]}
        fetchPage={(page) =>
          api.page<ShopSaleDto>(`/shops/${shopId}/books/sales`, {
            page,
            period: filter === 'all' || filter === 'owing' ? undefined : filter,
            owing: filter === 'owing' ? 'true' : undefined,
          })
        }
        keyOf={(s) => s.id}
        renderItem={(s) => <SaleRow sale={s} shopId={shopId} />}
        empty={
          filter === 'owing'
            ? { title: 'Nobody owes you', message: 'Sales where the customer pays later show here until they pay.' }
            : { title: 'No sales recorded', message: 'Record sales made in the shop — cash, transfer, POS or on credit — so your stock and money stay right.' }
        }
      />
    </Screen>
  );
}

function SaleRow({ sale, shopId }: { sale: ShopSaleDto; shopId: string }) {
  const first = sale.items[0];
  const more = sale.items.length - 1;
  return (
    <Pressable onPress={() => router.push(`/seller/${shopId}/sales/${sale.id}` as never)} className="mb-2 rounded-2xl border border-line bg-white p-3.5 active:bg-cream-50" accessibilityRole="button">
      <View className="flex-row items-start justify-between">
        <View className="mr-3 flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-ink-900">
            {sale.customerName ?? 'Walk-in customer'}
          </Text>
          <Text numberOfLines={1} className="mt-0.5 text-sm text-ink-600">
            {formatQuantity(first.quantity, first.unit)} {first.name}
            {more > 0 ? ` + ${more} more` : ''}
          </Text>
        </View>
        <View className="items-end">
          <Text className={`text-base font-bold ${sale.status === 'voided' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{formatNaira(sale.totalKobo)}</Text>
          {sale.status === 'voided' ? <Badge label="Cancelled" tone="neutral" /> : sale.balanceKobo > 0 ? <Badge label={`Owes ${formatNaira(sale.balanceKobo)}`} tone="warning" /> : <Badge label="Paid" tone="success" />}
        </View>
      </View>
      <Text className="mt-1.5 text-xs text-ink-400">
        {formatDateTime(sale.soldAt)} · {sale.recordedBy.fullName.replace('[DEMO] ', '')}
      </Text>
    </Pressable>
  );
}
