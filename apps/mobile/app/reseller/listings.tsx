import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react-native';
import type { ResellerListingDto } from '@kkdm/shared';
import { Badge, Button, PaginatedList, Screen, Sheet, TextField, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { formatNaira, koboToNairaInput, nairaInputToKobo, unitLabel } from '@/lib/format';

/** The reseller's products: their price, what they pay the shop, their profit, and whether customers can see it. */
export default function MyListings() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const sheet = useRef<SheetHandle>(null);
  const [current, setCurrent] = useState<ResellerListingDto | null>(null);
  const [price, setPrice] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['reseller'] });

  const update = useMutation({
    mutationFn: (body: { priceKobo?: number; status?: 'active' | 'paused' }) => api.patch<ResellerListingDto>(`/resellers/me/listings/${current!.id}`, body),
    onSuccess: (l) => {
      setCurrent(l);
      refresh();
      toast.success(l.available ? 'Saved — customers can see it' : 'Saved');
    },
    onError: (e) => toast.apiError(e),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/resellers/me/listings/${current!.id}`),
    onSuccess: () => {
      sheet.current?.close();
      refresh();
      toast.success('Removed from your products');
    },
    onError: (e) => toast.apiError(e),
  });

  const open = (l: ResellerListingDto) => {
    setCurrent(l);
    setPrice(koboToNairaInput(l.priceKobo));
    sheet.current?.open();
  };
  const s = current?.source;
  const newPrice = nairaInputToKobo(price);
  const profit = s?.resellerPriceKobo != null && newPrice != null ? newPrice - s.resellerPriceKobo : null;

  return (
    <Screen title="My products" subtitle="Products you resell at your price" scroll={false} padded={false} footer={<Button title="Find more products" icon={Search} fullWidth onPress={() => router.push('/search')} />}>
      <PaginatedList<ResellerListingDto>
        queryKey={['reseller', 'listings', 'all']}
        fetchPage={(page) => api.page<ResellerListingDto>('/resellers/me/listings', { page })}
        keyOf={(l) => l.id}
        renderItem={(l) => (
          <Pressable onPress={() => open(l)} className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-2.5 active:bg-cream-50">
            <View className="h-14 w-14 overflow-hidden rounded-lg bg-cream-200">{l.product.thumbnailUrl ? <Image source={{ uri: l.product.thumbnailUrl }} style={{ width: 56, height: 56 }} /> : null}</View>
            <View className="ml-3 flex-1">
              <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{l.product.name}</Text>
              <Text className="text-xs text-ink-600">
                You sell at {formatNaira(l.priceKobo)} / {unitLabel(l.product.unit)}
              </Text>
              {l.source?.profitPerUnitKobo != null ? (
                <Text className={`text-xs font-semibold ${l.source.profitPerUnitKobo >= 0 ? 'text-brand-700' : 'text-danger-500'}`}>
                  {l.source.profitPerUnitKobo >= 0 ? `You make ${formatNaira(l.source.profitPerUnitKobo)} each` : `You lose ${formatNaira(-l.source.profitPerUnitKobo)} each`}
                </Text>
              ) : null}
            </View>
            {!l.available && l.status === 'active' ? <Badge label="Hidden" tone="danger" /> : l.status === 'paused' ? <Badge label="Paused" tone="neutral" /> : <Badge label="Live" tone="success" />}
          </Pressable>
        )}
        empty={{ title: 'No products yet', message: 'Open a product that shows a reseller price and tap “Add to my products”.', action: 'Find products', onAction: () => router.push('/search') }}
      />

      <Sheet ref={sheet} title={current?.product.name ?? ''} snapPoints={['85%']}>
        {current ? (
          <View>
            {!current.available && current.status === 'active' ? (
              <View className="mb-3 rounded-xl bg-danger-50 p-3">
                <Text className="text-sm font-semibold text-danger-700">Customers can’t see this</Text>
                <Text className="text-sm text-ink-700">{current.unavailableReason}</Text>
              </View>
            ) : null}
            {s ? (
              <View className="mb-3 rounded-xl bg-cream-200 p-3">
                <Text className="text-xs text-ink-500">From {s.shopName} (only you see this)</Text>
                <Text className="mt-0.5 text-sm text-ink-800">
                  Reseller price {s.resellerPriceKobo != null ? formatNaira(s.resellerPriceKobo) : '—'} · shop’s normal price {formatNaira(s.retailPriceKobo)}
                </Text>
              </View>
            ) : null}
            <TextField
              label={`Your selling price per ${unitLabel(current.product.unit)} (₦)`}
              keyboardType="numeric"
              value={price}
              onChangeText={setPrice}
              hint={profit != null ? (profit >= 0 ? `You make ${formatNaira(profit)} on each ${unitLabel(current.product.unit)}` : 'Below the reseller price — not allowed') : undefined}
            />
            <Button title="Save price" fullWidth loading={update.isPending && update.variables?.priceKobo != null} disabled={newPrice == null || newPrice === current.priceKobo} onPress={() => update.mutate({ priceKobo: newPrice! })} />
            <View className="mt-3 flex-row">
              <Button title="Order from shop" variant="outline" className="mr-2 flex-1" onPress={() => s && router.push(`/product/${s.productId}`)} />
              <Button title="See as customer" variant="outline" className="flex-1" onPress={() => router.push(`/listing/${current.id}`)} />
            </View>
            <Button
              title={current.status === 'active' ? 'Pause (hide from customers)' : 'Show to customers again'}
              variant="ghost"
              className="mt-2"
              onPress={() => update.mutate({ status: current.status === 'active' ? 'paused' : 'active' })}
            />
            <Button
              title="Remove from my products"
              variant="ghost"
              onPress={async () => {
                if ((await confirm({ title: 'Remove this product?', destructive: true, confirmLabel: 'Remove' })).confirmed) remove.mutate();
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
