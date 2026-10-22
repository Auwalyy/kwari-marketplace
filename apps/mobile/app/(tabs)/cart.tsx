import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Trash2 } from 'lucide-react-native';
import type { CartDto } from '@kkdm/shared';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, LocationBreadcrumbView, QuantityStepper, Badge, toast, useConfirm } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatNaira, unitLabel } from '@/lib/format';
import { useAuth } from '@/store/auth';

export default function CartTab() {
  const insets = useSafeAreaInsets();
  const authed = useAuth((s) => s.status === 'authenticated');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.get<CartDto>('/cart'), enabled: authed });
  const setCart = (data: CartDto) => qc.setQueryData(['cart'], data);
  const update = useMutation({ mutationFn: ({ id, quantity }: { id: string; quantity: number }) => api.patch<CartDto>(`/cart/items/${id}`, { quantity }), onSuccess: setCart, onError: (e) => toast.apiError(e) });
  const remove = useMutation({ mutationFn: (id: string) => api.del<CartDto>(`/cart/items/${id}`), onSuccess: setCart, onError: (e) => toast.apiError(e) });

  const header = (
    <View className="px-4 pb-2 pt-2">
      <Text className="text-2xl font-bold text-ink-900">Cart</Text>
    </View>
  );

  if (!authed) {
    return (
      <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
        {header}
        <EmptyState icon={ShoppingCart} title="Sign in to use your cart" message="Browse freely as a guest. Create an account to order, chat with sellers and track delivery." action="Sign in" onAction={() => router.push('/(auth)/login')} />
      </View>
    );
  }

  const data = cart.data;
  const blocking = data?.groups.some((g) => g.lines.some((l) => !l.available));

  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} refreshControl={<RefreshControl refreshing={cart.isRefetching} onRefresh={() => void cart.refetch()} tintColor={colors.brand} />}>
        {cart.isPending ? <ListSkeleton /> : cart.isError ? <ErrorState error={cart.error} onRetry={() => cart.refetch()} /> : null}
        {data && !data.groups.length ? <EmptyState icon={ShoppingCart} title="Your cart is empty" message="Find fabrics by photo or search the market." action="Start shopping" onAction={() => router.push('/(tabs)')} /> : null}
        {data?.groups.map((g) => (
          <Card key={g.shop.id} className="mb-4">
            <Pressable onPress={() => router.push(`/shop/${g.shop.slug}`)}>
              <Text className="text-base font-bold text-ink-900">{g.shop.name}</Text>
              <LocationBreadcrumbView breadcrumb={g.shop.breadcrumb} compact />
            </Pressable>
            <Text className="mb-2 mt-1 text-xs text-ink-500">Each shop fulfils its own order separately.</Text>
            {g.lines.map((l) => (
              <View key={l.id} className="border-t border-line py-3">
                <View className="flex-row">
                  <Pressable onPress={() => router.push(`/product/${l.productId}`)} className="h-16 w-16 overflow-hidden rounded-lg bg-cream-200">
                    {l.thumbnailUrl ? <Image source={{ uri: l.thumbnailUrl }} style={{ width: 64, height: 64 }} /> : null}
                  </Pressable>
                  <View className="ml-3 flex-1">
                    <Text numberOfLines={2} className="text-sm font-semibold text-ink-900">
                      {l.productName}
                    </Text>
                    {l.variantLabel ? <Text className="text-xs text-ink-500">{l.variantLabel}</Text> : null}
                    <Text className="mt-0.5 text-xs text-ink-600">
                      {formatNaira(l.unitPriceKobo)} / {unitLabel(l.unit)}
                      {l.wholesaleApplied ? ' · wholesale price' : ''}
                      {l.quotationId ? ' · agreed quotation price' : ''}
                    </Text>
                    {l.issue ? <Badge label={l.issue} tone="danger" className="mt-1" /> : null}
                  </View>
                  <Pressable
                    onPress={async () => {
                      const r = await confirm({ title: 'Remove item?', message: l.productName, confirmLabel: 'Remove', destructive: true });
                      if (r.confirmed) remove.mutate(l.id);
                    }}
                    hitSlop={8}
                    accessibilityLabel="Remove item"
                  >
                    <Trash2 size={18} color={colors.inkFaint} />
                  </Pressable>
                </View>
                <View className="mt-2 flex-row items-center justify-between">
                  {l.quotationId ? (
                    <Text className="text-sm text-ink-600">
                      {l.quantity} {unitLabel(l.unit, l.quantity)}
                    </Text>
                  ) : (
                    <QuantityStepper value={l.quantity} onChange={(quantity) => update.mutate({ id: l.id, quantity })} />
                  )}
                  <Text className="text-base font-bold text-ink-900">{formatNaira(l.lineTotalKobo)}</Text>
                </View>
              </View>
            ))}
            <View className="flex-row justify-between border-t border-line pt-3">
              <Text className="text-ink-600">Subtotal</Text>
              <Text className="font-bold text-ink-900">{formatNaira(g.subtotalKobo)}</Text>
            </View>
          </Card>
        ))}
      </ScrollView>
      {data?.groups.length ? (
        <View className="border-t border-line bg-white px-4 pt-3" style={{ paddingBottom: 12 }}>
          <View className="mb-2 flex-row justify-between">
            <Text className="text-ink-600">Items subtotal (delivery calculated at checkout)</Text>
            <Text className="text-lg font-bold text-ink-900">{formatNaira(data.subtotalKobo)}</Text>
          </View>
          <Button title={blocking ? 'Fix unavailable items to continue' : 'Proceed to checkout'} disabled={blocking} onPress={() => router.push('/checkout')} fullWidth size="lg" />
        </View>
      ) : null}
    </View>
  );
}
