import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Heart, MessageCircle, MoreVertical, ShoppingCart, Store } from 'lucide-react-native';
import { resolveUnitPrice, type ConversationDto, type ProductDto, type ReviewDto, type VisualSearchResponse } from '@kkdm/shared';
import { ActionSheet, Body, Button, Card, Chip, ErrorState, IconButton, KeyValue, LoadingView, LocationBreadcrumbView, PriceLabel, QuantityStepper, Screen, SectionHeader, StockIndicator, VerificationBadge, WholesaleLine, toast, type SheetHandle } from '@/components/ui';
import { ProductCard } from '@/components/cards';
import { colors } from '@/constants/theme';
import { useAppConfig, useFavourites, useRequireAuth } from '@/hooks';
import { api } from '@/lib/api';
import { formatDate, formatNaira, formatQuantity, unitLabel } from '@/lib/format';

export default function ProductDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const requireAuth = useRequireAuth();
  const fav = useFavourites();
  const config = useAppConfig();
  const menu = useRef<SheetHandle>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [qty, setQty] = useState<number | null>(null);

  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDto>(`/products/${id}`) });
  const similar = useQuery({
    queryKey: ['similar', id],
    enabled: !!product.data && !!config.data?.features.visualSearch.available,
    queryFn: () => api.get<VisualSearchResponse>(`/visual-search/products/${id}/similar`, { limit: 8 }),
  });
  const reviews = useQuery({ queryKey: ['reviews', 'product', id], queryFn: () => api.page<ReviewDto>('/reviews', { productId: id, limit: 3 }) });

  const p = product.data;
  const quantity = qty ?? p?.minOrderQuantity ?? 1;
  const variant = p?.variants.find((v) => v.id === variantId);
  const pricing = useMemo(() => {
    if (!p) return null;
    const retail = variant?.priceOverrideKobo ?? p.retailPriceKobo;
    const r = resolveUnitPrice({ retailPriceKobo: retail, wholesalePriceKobo: p.wholesalePriceKobo, wholesaleMinQuantity: p.wholesaleMinQuantity }, quantity);
    return { ...r, total: Math.round((r.unitPriceKobo * Math.round(quantity * 100)) / 100) };
  }, [p, variant, quantity]);

  const addToCart = useMutation({
    mutationFn: () => api.post('/cart/items', { productId: id, variantId: variantId ?? null, quantity }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      toast.success('Added to cart');
    },
    onError: (e) => toast.apiError(e),
  });
  const chat = useMutation({
    mutationFn: () => api.post<ConversationDto>('/conversations', { shopId: p!.shop.id, productId: p!.id }),
    onSuccess: (c) => router.push(`/chat/${c.id}`),
    onError: (e) => toast.apiError(e),
  });

  if (product.isPending) return <Screen title=""><LoadingView /></Screen>;
  if (product.isError) return <Screen title="Product"><ErrorState error={product.error} onRetry={() => product.refetch()} /></Screen>;
  const prod = product.data;
  const needsVariant = prod.variants.length > 0 && !variant;
  const stockForSelection = variant ? variant.stockQuantity : prod.stockQuantity;
  const insufficient = prod.trackInventory && stockForSelection < quantity;
  const outOfStock = prod.stockStatus === 'out_of_stock' || (variant && variant.stockQuantity <= 0);
  const unpublished = prod.status !== 'published';

  return (
    <Screen
      title=""
      padded={false}
      right={
        <>
          <IconButton icon={Heart} label="Save" color={fav.products.has(prod.id) ? colors.danger : colors.ink} onPress={() => fav.toggle('product', prod.id)} />
          <IconButton icon={MoreVertical} label="More" onPress={() => menu.current?.open()} />
        </>
      }
      footer={
        unpublished ? undefined : (
          <View>
            {pricing ? (
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-sm text-ink-600">
                  {formatQuantity(quantity, prod.unit)} × {formatNaira(pricing.unitPriceKobo)}
                  {pricing.wholesale ? ' (wholesale)' : ''}
                </Text>
                <Text className="text-lg font-bold text-ink-900">{formatNaira(pricing.total)}</Text>
              </View>
            ) : null}
            <View className="flex-row">
              <Button title="Chat" icon={MessageCircle} variant="outline" className="mr-2" onPress={() => requireAuth(() => chat.mutate(), 'Sign in to chat with the seller')} loading={chat.isPending} />
              <Button
                title={outOfStock ? 'Out of stock' : needsVariant ? 'Choose an option' : insufficient ? 'Not enough stock' : 'Add to cart'}
                icon={ShoppingCart}
                className="flex-1"
                disabled={!!outOfStock || needsVariant || insufficient}
                loading={addToCart.isPending}
                onPress={() => requireAuth(() => addToCart.mutate(), 'Sign in to add items to your cart')}
              />
            </View>
          </View>
        )
      }
    >
      <FlatList
        data={prod.images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => i.id}
        onMomentumScrollEnd={(e) => setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Image source={{ uri: item.url }} placeholder={{ uri: item.thumbnailUrl }} style={{ width, height: width }} contentFit="cover" transition={150} />}
        ListEmptyComponent={<View style={{ width, height: width * 0.6 }} className="items-center justify-center bg-cream-200"><Text className="text-ink-500">No photos</Text></View>}
      />
      {prod.images.length > 1 ? (
        <View className="mt-2 flex-row justify-center">
          {prod.images.map((i, idx) => (
            <View key={i.id} className={`mx-0.5 h-1.5 rounded-full ${idx === imageIndex ? 'w-4 bg-brand-700' : 'w-1.5 bg-cream-300'}`} />
          ))}
        </View>
      ) : null}

      <View className="px-4 pt-3">
        {unpublished ? <Body className="mb-2 rounded-lg bg-warning-50 p-2 text-sm">This product is not published (staff preview).</Body> : null}
        <Text className="text-xl font-bold text-ink-900">{prod.name}</Text>
        <View className="mt-2 flex-row items-center justify-between">
          <PriceLabel kobo={variant?.priceOverrideKobo ?? prod.retailPriceKobo} unit={prod.unit} size="lg" />
          <StockIndicator status={prod.stockStatus} />
        </View>
        <WholesaleLine priceKobo={prod.wholesalePriceKobo} minQty={prod.wholesaleMinQuantity} unit={prod.unit} />
        {prod.minOrderQuantity > 1 ? <Text className="mt-1 text-xs text-ink-500">Minimum order {formatQuantity(prod.minOrderQuantity, prod.unit)}</Text> : null}

        {prod.variants.length ? (
          <View className="mt-4">
            <Text className="mb-2 text-sm font-semibold text-ink-700">Options</Text>
            <View className="flex-row flex-wrap">
              {prod.variants.filter((v) => v.active).map((v) => (
                <Chip key={v.id} label={`${v.label}${v.stockQuantity <= 0 ? ' (sold out)' : ''}`} selected={variantId === v.id} onPress={() => setVariantId(v.id)} />
              ))}
            </View>
          </View>
        ) : null}

        {!unpublished ? (
          <View className="mt-4 flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-ink-700">Quantity ({unitLabel(prod.unit, 2)})</Text>
            <QuantityStepper value={quantity} onChange={setQty} step={prod.unit === 'yard' || prod.unit === 'metre' ? 1 : 1} min={prod.minOrderQuantity} />
          </View>
        ) : null}
        {prod.wholesaleMinQuantity && quantity < prod.wholesaleMinQuantity ? (
          <Text className="mt-2 text-xs text-brand-700">Buy {formatQuantity(prod.wholesaleMinQuantity, prod.unit)} or more for the wholesale price.</Text>
        ) : null}

        <Card className="mt-4" onPress={() => router.push(`/shop/${prod.shop.slug}`)}>
          <View className="flex-row items-center">
            <Store size={20} color={colors.brand} />
            <Text className="ml-2 flex-1 text-base font-semibold text-ink-900">{prod.shop.name}</Text>
            <VerificationBadge status={prod.shop.verificationStatus} compact />
          </View>
          <View className="mt-1.5">
            <LocationBreadcrumbView breadcrumb={prod.shop.breadcrumb} />
          </View>
          <Button title="Request wholesale quotation" icon={FileText} variant="secondary" size="sm" className="mt-3 self-start" onPress={() => requireAuth(() => router.push({ pathname: '/quotations/new', params: { shopId: prod.shop.id, productId: prod.id } }))} />
        </Card>

        <SectionHeader title="Details" />
        {prod.description ? <Body className="mb-2 text-sm leading-5">{prod.description}</Body> : null}
        <Card>
          {prod.categoryName ? <KeyValue label="Category" value={prod.categoryName + (prod.subcategory ? ` · ${prod.subcategory}` : '')} /> : null}
          {prod.material ? <KeyValue label="Material (seller-stated)" value={prod.material} /> : null}
          {prod.brand ? <KeyValue label="Brand / manufacturer" value={prod.brand} /> : null}
          {prod.colours.length ? <KeyValue label="Colours" value={prod.colours.join(', ')} /> : null}
          {prod.patterns.length ? <KeyValue label="Pattern" value={prod.patterns.join(', ')} /> : null}
          <KeyValue label="Sold by" value={unitLabel(prod.unit)} />
          <KeyValue label="Listed" value={formatDate(prod.createdAt)} />
        </Card>

        {similar.data?.matches.length ? (
          <>
            <SectionHeader title="Visually similar fabrics" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {similar.data.matches.map((m) => (
                <View key={m.product.id} style={{ width: 160 }} className="mr-3">
                  <ProductCard product={m.product} />
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}

        <SectionHeader title={`Reviews (${prod.ratingCount})`} action={prod.ratingCount ? 'See all' : undefined} onAction={() => router.push({ pathname: '/reviews', params: { productId: prod.id, title: prod.name } })} />
        {reviews.data?.items.length ? (
          reviews.data.items.map((r) => (
            <Card key={r.id} className="mb-2">
              <View className="flex-row justify-between">
                <Text className="font-semibold text-ink-900">{r.author.fullName}</Text>
                <Text className="text-gold-500">{'★'.repeat(r.rating)}</Text>
              </View>
              {r.text ? <Body className="mt-1 text-sm">{r.text}</Body> : null}
            </Card>
          ))
        ) : (
          <Pressable>
            <Text className="text-sm text-ink-500">No reviews yet.</Text>
          </Pressable>
        )}
      </View>

      <ActionSheet
        ref={menu}
        actions={[{ label: 'Report this product', onPress: () => requireAuth(() => router.push({ pathname: '/report', params: { targetType: 'product', targetId: prod.id, label: prod.name } })) }]}
      />
    </Screen>
  );
}
