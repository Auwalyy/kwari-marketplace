import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Grid3x3, Home as HomeIcon, Store } from 'lucide-react-native';
import type { CategoryDto, MarketDto, SectionDto } from '@kkdm/shared';
import { Card, Chip, ErrorState, ListSkeleton, SectionHeader } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';

/** Market directory: markets → sections → houses → shops, plus category browsing. */
export default function MarketTab() {
  const insets = useSafeAreaInsets();
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api.page<MarketDto>('/markets', { limit: 50 }) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const sections = useQueries({
    queries: (markets.data?.items ?? []).map((m) => ({ queryKey: ['sections', m.id], queryFn: () => api.get<SectionDto[]>(`/markets/${m.id}/sections`), enabled: m.usesSections })),
  });

  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      <View className="px-4 pb-3 pt-2">
        <Text className="mb-3 text-2xl font-bold text-ink-900">Market directory</Text>
        <Pressable onPress={() => router.push('/search')}>
          <View pointerEvents="none">
            <SearchBar editable={false} placeholder="Search shops, products, house numbers" />
          </View>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={markets.isRefetching} onRefresh={() => void markets.refetch()} tintColor={colors.brand} />}>
        <View className="flex-row">
          <QuickLink icon={Store} label="All shops" onPress={() => router.push('/shops')} />
          <QuickLink icon={HomeIcon} label="Houses" onPress={() => router.push('/houses')} />
          <QuickLink icon={Grid3x3} label="Wholesale" onPress={() => router.push({ pathname: '/shops', params: { wholesaleOnly: '1' } })} />
        </View>

        {markets.isPending ? <ListSkeleton rows={3} /> : markets.isError ? <ErrorState error={markets.error} onRetry={() => markets.refetch()} /> : null}

        {markets.data?.items.map((m, i) => (
          <View key={m.id}>
            <SectionHeader title={m.name} action="Details" onAction={() => router.push(`/market/${m.id}`)} />
            <Text className="-mt-2 mb-3 text-sm text-ink-500">
              {m.city}, {m.region} · {m.stats?.houses ?? 0} houses · {m.stats?.shops ?? 0} shops
            </Text>
            {m.usesSections ? (
              sections[i]?.data?.map((s) => (
                <Card key={s.id} className="mb-2 flex-row items-center py-3" onPress={() => router.push(`/section/${s.id}`)}>
                  <View className="mr-3 h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                    <Text className="font-bold text-brand-800">{s.code}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-ink-900">{s.name}</Text>
                    <Text className="text-xs text-ink-500">{s.houseCount ?? 0} houses</Text>
                  </View>
                  <ChevronRight size={18} color={colors.inkFaint} />
                </Card>
              ))
            ) : (
              <Card onPress={() => router.push({ pathname: '/houses', params: { marketId: m.id } })} className="flex-row items-center">
                <Building2 size={20} color={colors.brand} />
                <Text className="ml-3 flex-1 font-semibold text-ink-900">Browse houses</Text>
                <ChevronRight size={18} color={colors.inkFaint} />
              </Card>
            )}
            {m.usesSections ? (
              <Pressable onPress={() => router.push({ pathname: '/houses', params: { marketId: m.id } })} className="py-2">
                <Text className="font-semibold text-brand-700">All houses in {m.name} →</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        {categories.data?.length ? (
          <>
            <SectionHeader title="Browse by category" />
            <View className="flex-row flex-wrap">
              {categories.data.map((c) => (
                <Chip key={c.id} label={`${c.name}${c.productCount ? ` · ${c.productCount}` : ''}`} onPress={() => router.push({ pathname: '/search', params: { categoryId: c.id, title: c.name } })} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function QuickLink({ icon: Icon, label, onPress }: { icon: typeof Store; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="mr-2 flex-1 items-center rounded-2xl border border-line bg-white py-3 active:bg-cream-50" accessibilityRole="button">
      <Icon size={22} color={colors.brand} />
      <Text className="mt-1 text-xs font-semibold text-ink-800">{label}</Text>
    </Pressable>
  );
}
