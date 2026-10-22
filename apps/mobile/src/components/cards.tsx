import { memo } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Camera, Heart, Search, Store } from 'lucide-react-native';
import type { OrderDto, ProductSummaryDto, ShopSummaryDto } from '@kkdm/shared';
import { colors } from '@/constants/theme';
import { formatDate, formatNaira, unitLabel } from '@/lib/format';
import { LocationBreadcrumbView, OrderStatusBadge, PaymentStatusBadge, Rating, SponsoredLabel, StockIndicator, VerificationBadge, WholesaleLine } from './ui/commerce';
import { cx } from './ui/primitives';

const BLURHASH = 'L9N1G?~q00of_3t7ayof00ay?bj[';

export const ProductCard = memo(function ProductCard({ product, onPress, favourite, onToggleFavourite, extra, className }: { product: ProductSummaryDto; onPress?: () => void; favourite?: boolean; onToggleFavourite?: () => void; extra?: React.ReactNode; className?: string }) {
  return (
    <Pressable onPress={onPress ?? (() => router.push(`/product/${product.id}`))} className={cx('mb-4 overflow-hidden rounded-2xl border border-line bg-white active:opacity-90', className)} accessibilityRole="button" accessibilityLabel={`${product.name}, ${formatNaira(product.retailPriceKobo)} per ${unitLabel(product.unit)}`}>
      <View className="aspect-square w-full bg-cream-200">
        {product.thumbnailUrl ? <Image source={{ uri: product.thumbnailUrl }} placeholder={{ blurhash: BLURHASH }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} recyclingKey={product.id} /> : null}
        {product.sponsored ? (
          <View className="absolute left-2 top-2">
            <SponsoredLabel />
          </View>
        ) : null}
        {onToggleFavourite ? (
          <Pressable onPress={onToggleFavourite} hitSlop={8} className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-white/90" accessibilityLabel={favourite ? 'Remove from favourites' : 'Save to favourites'}>
            <Heart size={16} color={favourite ? colors.danger : colors.ink} fill={favourite ? colors.danger : 'transparent'} />
          </Pressable>
        ) : null}
      </View>
      <View className="p-2.5">
        <Text numberOfLines={2} className="text-sm font-semibold leading-5 text-ink-900">
          {product.name}
        </Text>
        <Text className="mt-1 text-base font-bold text-ink-900">
          {formatNaira(product.retailPriceKobo)}
          <Text className="text-xs font-normal text-ink-500"> / {unitLabel(product.unit)}</Text>
        </Text>
        <WholesaleLine priceKobo={product.wholesalePriceKobo} minQty={product.wholesaleMinQuantity} unit={product.unit} />
        <View className="mt-1.5 flex-row items-center">
          <Text numberOfLines={1} className="mr-1 flex-shrink text-xs text-ink-600">
            {product.shop.name}
          </Text>
          <VerificationBadge status={product.shop.verificationStatus} compact />
        </View>
        {product.stockStatus !== 'in_stock' ? (
          <View className="mt-1.5">
            <StockIndicator status={product.stockStatus} />
          </View>
        ) : null}
        {extra}
      </View>
    </Pressable>
  );
});

export const ShopCard = memo(function ShopCard({ shop, onPress, horizontal }: { shop: ShopSummaryDto; onPress?: () => void; horizontal?: boolean }) {
  return (
    <Pressable onPress={onPress ?? (() => router.push(`/shop/${shop.slug}`))} className={cx('mb-3 rounded-2xl border border-line bg-white p-3 active:bg-cream-50', horizontal && 'mr-3 w-64')} accessibilityRole="button">
      <View className="flex-row items-center">
        <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-brand-50">
          {shop.logoUrl ? <Image source={{ uri: shop.logoUrl }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <Store size={22} color={colors.brand} />}
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-center">
            <Text numberOfLines={1} className="mr-1 flex-shrink text-base font-semibold text-ink-900">
              {shop.name}
            </Text>
            <VerificationBadge status={shop.verificationStatus} compact />
            {shop.sponsored ? <View className="ml-1"><SponsoredLabel /></View> : null}
          </View>
          <Rating value={shop.ratingAverage} count={shop.ratingCount} />
        </View>
      </View>
      <View className="mt-2">
        <LocationBreadcrumbView breadcrumb={shop.breadcrumb} compact />
      </View>
      <Text numberOfLines={1} className="mt-1 text-xs text-ink-500">
        {shop.activeProductCount} products{shop.wholesaleAvailable ? ' · Wholesale' : ''}
        {shop.categoryNames.length ? ` · ${shop.categoryNames.slice(0, 2).join(', ')}` : ''}
      </Text>
    </Pressable>
  );
});

export function OrderCard({ order, onPress, sellerView }: { order: OrderDto; onPress: () => void; sellerView?: boolean }) {
  const first = order.items[0];
  return (
    <Pressable onPress={onPress} className="mb-3 rounded-2xl border border-line bg-white p-3 active:bg-cream-50" accessibilityRole="button">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-ink-900">{order.reference}</Text>
        <OrderStatusBadge status={order.status} />
      </View>
      <View className="mt-2 flex-row">
        <View className="h-14 w-14 overflow-hidden rounded-lg bg-cream-200">{first?.thumbnailUrl ? <Image source={{ uri: first.thumbnailUrl }} style={{ width: 56, height: 56 }} /> : null}</View>
        <View className="ml-3 flex-1">
          <Text numberOfLines={1} className="text-sm text-ink-800">
            {first?.productName}
            {order.items.length > 1 ? ` + ${order.items.length - 1} more` : ''}
          </Text>
          <Text className="mt-0.5 text-xs text-ink-500">{sellerView ? order.customer.fullName : order.shop.name} · {formatDate(order.createdAt)}</Text>
          <View className="mt-1 flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink-900">{formatNaira(order.totalKobo)}</Text>
            <PaymentStatusBadge status={order.paymentStatus} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Search bar with a camera shortcut to visual fabric search. */
export function SearchBar({ value, onChangeText, onSubmit, autoFocus, onPressVisual, onFocus, editable = true, placeholder = 'Search fabrics, shops, house numbers' }: { value?: string; onChangeText?: (t: string) => void; onSubmit?: () => void; autoFocus?: boolean; onPressVisual?: () => void; onFocus?: () => void; editable?: boolean; placeholder?: string }) {
  return (
    <View className="h-12 flex-row items-center rounded-xl border border-line bg-white px-3">
      <Search size={18} color={colors.inkFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        autoFocus={autoFocus}
        editable={editable}
        onFocus={onFocus}
        returnKeyType="search"
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        className="mx-2 flex-1 text-base text-ink-900"
        accessibilityLabel="Search"
      />
      {onPressVisual ? (
        <Pressable onPress={onPressVisual} hitSlop={8} accessibilityLabel="Find fabric by image" className="h-8 w-8 items-center justify-center rounded-lg bg-brand-50">
          <Camera size={18} color={colors.brand} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Two-column grid helper for ScrollView-based layouts. */
export function ProductGrid({ products, favouriteIds, onToggleFavourite }: { products: ProductSummaryDto[]; favouriteIds?: Set<string>; onToggleFavourite?: (id: string) => void }) {
  return (
    <View className="flex-row flex-wrap justify-between">
      {products.map((p) => (
        <View key={p.id} className="w-[48.5%]">
          <ProductCard product={p} favourite={favouriteIds?.has(p.id)} onToggleFavourite={onToggleFavourite ? () => onToggleFavourite(p.id) : undefined} />
        </View>
      ))}
    </View>
  );
}
