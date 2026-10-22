import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Bell, Camera, ChevronRight, Layers, ScanSearch } from 'lucide-react-native';
import type { ProductSummaryDto, ShopSummaryDto } from '@kkdm/shared';
import { Chip, ErrorState, IconButton, ProductGridSkeleton, SectionHeader } from '@/components/ui';
import { ProductGrid, SearchBar, ShopCard } from '@/components/cards';
import { colors } from '@/constants/theme';
import { useAppConfig, useFavourites, useUnreadCounts } from '@/hooks';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

interface Discovery {
  featuredShops: ShopSummaryDto[];
  featuredProducts: ProductSummaryDto[];
  recentlyAdded: ProductSummaryDto[];
  recommendedShops: ShopSummaryDto[];
  wholesaleSellers: ShopSummaryDto[];
  popularCategories: { id: string; name: string; slug: string; productCount: number }[];
  recentlyViewed: ProductSummaryDto[];
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const unread = useUnreadCounts();
  const fav = useFavourites();
  const config = useAppConfig();
  const q = useQuery({ queryKey: ['discovery', !!user], queryFn: () => api.get<Discovery>('/search/discovery') });
  const d = q.data;
  const firstName = user?.fullName.replace('[DEMO]', '').trim().split(' ')[0];

  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brand} />}
        keyboardShouldPersistTaps="handled"
      >
        <View className="bg-brand-800 px-4 pb-6 pt-3">
          <View className="mb-4 flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sm text-brand-200">{firstName ? `Sannu, ${firstName}` : 'Sannu da zuwa'}</Text>
              <Text className="text-2xl font-bold text-white">Kantin Kwari Market</Text>
            </View>
            {user ? <IconButton icon={Bell} label="Notifications" color={colors.white} onPress={() => router.push('/notifications')} badge={unread.notifications} /> : null}
          </View>
          <Pressable onPress={() => router.push('/search')}>
            <View pointerEvents="none">
              <SearchBar editable={false} />
            </View>
          </Pressable>
        </View>

        <View className="px-4">
          <Pressable
            onPress={() => router.push('/visual-search')}
            className="-mt-3 flex-row items-center rounded-2xl border border-gold-500/40 bg-gold-100 p-4 active:opacity-90"
            accessibilityRole="button"
            accessibilityLabel="Find fabric by image"
          >
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-brand-700">
              <ScanSearch size={26} color={colors.white} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-bold text-ink-900">Find fabric by image</Text>
              <Text className="text-sm text-ink-600">
                {config.data && !config.data.features.visualSearch.available ? 'Temporarily unavailable — use text search' : 'Take or upload a photo to see similar fabrics'}
              </Text>
            </View>
            <Camera size={20} color={colors.brand} />
          </Pressable>

          {q.isError ? (
            <View className="mt-6">
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            </View>
          ) : null}

          {d?.popularCategories.length ? (
            <>
              <SectionHeader title="Popular categories" action="Directory" onAction={() => router.push('/(tabs)/market')} />
              <View className="flex-row flex-wrap">
                {d.popularCategories.map((c) => (
                  <Chip key={c.id} label={`${c.name} · ${c.productCount}`} icon={Layers} onPress={() => router.push({ pathname: '/search', params: { categoryId: c.id, title: c.name } })} />
                ))}
              </View>
            </>
          ) : null}

          {d?.featuredShops.length ? (
            <>
              <SectionHeader title="Featured shops" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {d.featuredShops.map((s) => (
                  <ShopCard key={s.id} shop={s} horizontal />
                ))}
              </ScrollView>
            </>
          ) : null}

          {d?.featuredProducts.length ? (
            <>
              <SectionHeader title="Featured fabrics" />
              <ProductGrid products={d.featuredProducts} favouriteIds={fav.products} onToggleFavourite={(id) => fav.toggle('product', id)} />
            </>
          ) : null}

          {d?.recentlyViewed.length ? (
            <>
              <SectionHeader title="Recently viewed" action="See all" onAction={() => router.push('/recently-viewed')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {d.recentlyViewed.map((p) => (
                  <Pressable key={p.id} onPress={() => router.push(`/product/${p.id}`)} className="mr-3 w-32">
                    <View className="h-32 w-32 overflow-hidden rounded-xl bg-cream-200">
                      {p.thumbnailUrl ? <ProductThumb uri={p.thumbnailUrl} /> : null}
                    </View>
                    <Text numberOfLines={1} className="mt-1 text-xs text-ink-700">
                      {p.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          <SectionHeader title="Recently added" action="Search all" onAction={() => router.push({ pathname: '/search', params: { sort: 'newest' } })} />
          {q.isPending ? <ProductGridSkeleton /> : d?.recentlyAdded.length ? <ProductGrid products={d.recentlyAdded} favouriteIds={fav.products} onToggleFavourite={(id) => fav.toggle('product', id)} /> : <Text className="text-sm text-ink-500">No products have been published yet.</Text>}

          {d?.recommendedShops.length ? (
            <>
              <SectionHeader title="Recommended shops" action="All shops" onAction={() => router.push('/shops')} />
              {d.recommendedShops.slice(0, 4).map((s) => (
                <ShopCard key={s.id} shop={s} />
              ))}
            </>
          ) : null}

          {d?.wholesaleSellers.length ? (
            <>
              <SectionHeader title="Wholesale sellers" action="More" onAction={() => router.push({ pathname: '/shops', params: { wholesaleOnly: '1' } })} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {d.wholesaleSellers.map((s) => (
                  <ShopCard key={s.id} shop={s} horizontal />
                ))}
              </ScrollView>
            </>
          ) : null}

          <Pressable onPress={() => router.push('/(tabs)/market')} className="mt-6 flex-row items-center justify-between rounded-2xl bg-brand-50 p-4">
            <View className="flex-1">
              <Text className="text-base font-semibold text-brand-800">Explore the market directory</Text>
              <Text className="text-sm text-brand-700">Browse by section, house and shop number</Text>
            </View>
            <ChevronRight size={20} color={colors.brand} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function ProductThumb({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />;
}
