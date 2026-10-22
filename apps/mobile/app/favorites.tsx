import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { ProductSummaryDto, ShopSummaryDto } from '@kkdm/shared';
import { PaginatedList, ProductGridSkeleton, Screen, SegmentedControl } from '@/components/ui';
import { ProductCard, ShopCard } from '@/components/cards';
import { useFavourites } from '@/hooks';
import { api } from '@/lib/api';

export default function Favourites() {
  const [tab, setTab] = useState<'product' | 'shop'>('product');
  const fav = useFavourites();
  return (
    <Screen title="Favourites" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl options={[{ value: 'product', label: 'Products' }, { value: 'shop', label: 'Shops' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'product' ? (
        <PaginatedList<ProductSummaryDto>
          key="p"
          queryKey={['favorites', 'product']}
          fetchPage={(page) => api.page<ProductSummaryDto>('/favorites', { type: 'product', page })}
          keyOf={(p) => p.id}
          numColumns={2}
          contentPadding={12}
          skeleton={<View className="px-4"><ProductGridSkeleton /></View>}
          renderItem={(p) => (
            <View className="flex-1 px-1">
              <ProductCard product={p} favourite onToggleFavourite={() => fav.toggle('product', p.id)} />
            </View>
          )}
          empty={{ title: 'No saved products', message: 'Tap the heart on any product to save it.', action: 'Browse', onAction: () => router.push('/(tabs)') }}
        />
      ) : (
        <PaginatedList<ShopSummaryDto>
          key="s"
          queryKey={['favorites', 'shop']}
          fetchPage={(page) => api.page<ShopSummaryDto>('/favorites', { type: 'shop', page })}
          keyOf={(s) => s.id}
          renderItem={(s) => <ShopCard shop={s} />}
          empty={{ title: 'No saved shops', message: 'Save shops you buy from often.' }}
        />
      )}
    </Screen>
  );
}
