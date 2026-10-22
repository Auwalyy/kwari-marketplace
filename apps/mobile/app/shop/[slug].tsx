import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Clock, FileText, Heart, MessageCircle, MoreVertical, Navigation, Phone, Settings, Store } from 'lucide-react-native';
import type { ConversationDto, ProductSummaryDto, ReviewDto, ShopDto, ShopSummaryDto } from '@kkdm/shared';
import { ActionSheet, Badge, Body, Button, Card, Chip, ErrorState, IconButton, KeyValue, LoadingView, LocationBreadcrumbView, ProductGridSkeleton, Rating, Screen, SectionHeader, VerificationBadge, toast, type SheetHandle } from '@/components/ui';
import { ProductGrid, SearchBar, ShopCard } from '@/components/cards';
import { colors } from '@/constants/theme';
import { useFavourites, useRequireAuth } from '@/hooks';
import { api } from '@/lib/api';
import { formatDate, formatNaira } from '@/lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Storefront() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const requireAuth = useRequireAuth();
  const fav = useFavourites();
  const menu = useRef<SheetHandle>(null);
  const [category, setCategory] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  const shop = useQuery({ queryKey: ['shop', slug], queryFn: () => api.get<ShopDto & { viewerRole?: string }>(`/shops/${slug}`) });
  const s = shop.data;
  const products = useInfiniteQuery({
    queryKey: ['shop-products', s?.id, category, q],
    enabled: !!s,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.page<ProductSummaryDto>('/search/products', { shopId: s!.id, categoryId: category, q: q || undefined, sort: q ? 'relevance' : 'newest', page: pageParam, limit: 20 }),
    getNextPageParam: (last) => (last.meta.hasNextPage ? last.meta.page + 1 : undefined),
  });
  const reviews = useQuery({ queryKey: ['reviews', 'shop', s?.id], enabled: !!s, queryFn: () => api.page<ReviewDto>('/reviews', { shopId: s!.id, limit: 3 }) });
  const nearby = useQuery({ queryKey: ['nearby', s?.id], enabled: !!s, queryFn: () => api.get<{ sameHouse: ShopSummaryDto[]; sameSection: ShopSummaryDto[] }>(`/search/nearby-shops/${s!.id}`) });
  const chat = useMutation({
    mutationFn: () => api.post<ConversationDto>('/conversations', { shopId: s!.id }),
    onSuccess: (c) => router.push(`/chat/${c.id}`),
    onError: (e) => toast.apiError(e),
  });

  if (shop.isPending) return <Screen title="Shop"><LoadingView /></Screen>;
  if (shop.isError) return <Screen title="Shop"><ErrorState error={shop.error} onRetry={() => shop.refetch()} /></Screen>;
  const shopData = shop.data;
  const all = products.data?.pages.flatMap((p) => p.items) ?? [];
  const isStaff = !!shopData.viewerRole;

  return (
    <Screen
      title={shopData.name}
      subtitle={`Shop ${shopData.shopNumber} · ${shopData.shopCode}`}
      right={
        <>
          <IconButton icon={Heart} label="Save shop" color={fav.shops.has(shopData.id) ? colors.danger : colors.ink} onPress={() => fav.toggle('shop', shopData.id)} />
          <IconButton icon={MoreVertical} label="More" onPress={() => menu.current?.open()} />
        </>
      }
      padded={false}
      onRefresh={() => { void shop.refetch(); void products.refetch(); }}
      refreshing={shop.isRefetching}
    >
      <View className="h-36 w-full bg-brand-700">{shopData.coverUrl ? <Image source={{ uri: shopData.coverUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}</View>
      <View className="px-4">
        <View className="-mt-8 flex-row items-end">
          <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border-4 border-cream-100 bg-white">
            {shopData.logoUrl ? <Image source={{ uri: shopData.logoUrl }} style={{ width: 64, height: 64 }} /> : <Store size={26} color={colors.brand} />}
          </View>
          <View className="mb-1 ml-3 flex-1">
            <VerificationBadge status={shopData.verificationStatus} />
          </View>
        </View>
        <Text className="mt-2 text-2xl font-bold text-ink-900">{shopData.name}</Text>
        <View className="mt-1">
          <LocationBreadcrumbView breadcrumb={shopData.breadcrumb} />
        </View>
        <View className="mt-1 flex-row items-center">
          <Rating value={shopData.ratingAverage} count={shopData.ratingCount} />
          <Text className="ml-2 text-xs text-ink-500">· {shopData.activeProductCount} products{shopData.wholesaleAvailable ? ' · Wholesale' : ''}</Text>
        </View>
        {shopData.description ? <Body className="mt-3 text-sm">{shopData.description}</Body> : null}

        {isStaff ? (
          <Button title="Manage this shop" icon={Settings} variant="secondary" className="mt-4" onPress={() => router.push(`/seller/${shopData.id}`)} fullWidth />
        ) : (
          <View className="mt-4 flex-row">
            {shopData.contactPreferences.chat ? <Button title="Chat" icon={MessageCircle} className="mr-2 flex-1" loading={chat.isPending} onPress={() => requireAuth(() => chat.mutate(), 'Sign in to chat with this shop')} /> : null}
            <Button title="Quote" icon={FileText} variant="outline" className="mr-2 flex-1" onPress={() => requireAuth(() => router.push({ pathname: '/quotations/new', params: { shopId: shopData.id } }))} />
            {shopData.contactPhone ? <IconButton icon={Phone} label="Call shop" color={colors.brand} className="border border-line bg-white" onPress={() => void Linking.openURL(`tel:${shopData.contactPhone}`)} /> : null}
          </View>
        )}

        <Card className="mt-4">
          {shopData.locationDescription ? <KeyValue label="Where to find us" value={shopData.locationDescription} /> : null}
          <KeyValue label="Pickup" value={shopData.pickupAvailable ? 'Available at the shop' : 'Not offered'} />
          <KeyValue label="Delivery" value={shopData.deliveryAvailable ? shopData.deliveryOptions.map((o) => `${o.name} (${o.feeKobo == null ? 'quoted' : formatNaira(o.feeKobo)})`).join('\n') : 'Not offered'} />
          <KeyValue label="Payment" value={shopData.acceptedPaymentMethods.map((m) => ({ cash_on_pickup: 'Cash on pickup', bank_transfer: 'Bank transfer', online: 'Online' })[m]).join(', ')} />
          {shopData.businessHours.length ? (
            <KeyValue label="Hours" value={shopData.businessHours.map((h) => `${DAYS[h.day]} ${h.closed ? 'closed' : `${h.open}–${h.close}`}`).join('\n')} />
          ) : null}
          {shopData.breadcrumb ? (
            <Button title="View house" icon={Navigation} variant="ghost" size="sm" className="mt-1 self-start" onPress={() => router.push(`/house/${shopData.breadcrumb.houseId}`)} />
          ) : null}
        </Card>

        <SectionHeader title="Products" />
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Search this shop" />
        {shopData.categoryNames.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
            {shopData.categoryIds.map((id, i) => (
              <Chip key={id} label={shopData.categoryNames[i] ?? 'Category'} selected={category === id} onPress={() => setCategory(id)} />
            ))}
          </ScrollView>
        ) : null}
        <View className="mt-3">
          {products.isPending ? <ProductGridSkeleton /> : all.length ? <ProductGrid products={all} favouriteIds={fav.products} onToggleFavourite={(id) => fav.toggle('product', id)} /> : <Text className="text-sm text-ink-500">No products match.</Text>}
          {products.hasNextPage ? <Button title="Load more" variant="outline" loading={products.isFetchingNextPage} onPress={() => void products.fetchNextPage()} fullWidth /> : null}
        </View>

        <SectionHeader title={`Reviews (${shopData.ratingCount})`} action={shopData.ratingCount ? 'See all' : undefined} onAction={() => router.push({ pathname: '/reviews', params: { shopId: shopData.id, title: shopData.name } })} />
        {reviews.data?.items.length ? (
          reviews.data.items.map((r) => (
            <Card key={r.id} className="mb-2">
              <View className="flex-row justify-between">
                <Text className="font-semibold text-ink-900">{r.author.fullName}</Text>
                <Text className="text-gold-500">{'★'.repeat(r.rating)}</Text>
              </View>
              {r.text ? <Body className="mt-1 text-sm">{r.text}</Body> : null}
              <Text className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)} · verified purchase</Text>
              {r.response ? <Text className="mt-2 rounded-lg bg-cream-100 p-2 text-sm text-ink-700">Shop reply: {r.response.text}</Text> : null}
            </Card>
          ))
        ) : (
          <Text className="text-sm text-ink-500">No reviews yet. Only customers with completed orders can review.</Text>
        )}

        {nearby.data?.sameHouse.length ? (
          <>
            <SectionHeader title={`More in House ${shopData.breadcrumb.houseNumber}`} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {nearby.data.sameHouse.map((n) => <ShopCard key={n.id} shop={n} horizontal />)}
            </ScrollView>
          </>
        ) : null}
        {nearby.data?.sameSection.length ? (
          <>
            <SectionHeader title="Nearby in this section" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {nearby.data.sameSection.map((n) => <ShopCard key={n.id} shop={n} horizontal />)}
            </ScrollView>
          </>
        ) : null}
        <View className="mt-4 flex-row flex-wrap">
          {shopData.pickupAvailable ? <Badge label="Pickup" tone="success" className="mb-1 mr-1" /> : null}
          {shopData.deliveryAvailable ? <Badge label="Delivery" tone="info" className="mb-1 mr-1" /> : null}
          <View className="mb-1 flex-row items-center">
            <Clock size={12} color={colors.inkFaint} />
            <Text className="ml-1 text-xs text-ink-400">On Kantin Kwari since {formatDate(shopData.createdAt, { month: 'long', year: 'numeric' })}</Text>
          </View>
        </View>
      </View>

      <ActionSheet
        ref={menu}
        actions={[
          { label: 'Report this shop', onPress: () => requireAuth(() => router.push({ pathname: '/report', params: { targetType: 'shop', targetId: shopData.id, label: shopData.name } })) },
          { label: 'Block this shop', destructive: true, onPress: () => requireAuth(() => router.push({ pathname: '/report', params: { targetType: 'shop', targetId: shopData.id, label: shopData.name, block: '1' } })) },
        ]}
      />
    </Screen>
  );
}
