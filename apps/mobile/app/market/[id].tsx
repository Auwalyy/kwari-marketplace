import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Navigation } from 'lucide-react-native';
import type { MarketDto, SectionDto } from '@kkdm/shared';
import { Body, Button, Card, ErrorState, KeyValue, LoadingView, Screen, SectionHeader } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { openInMaps } from '@/components/directory';

export default function MarketDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const market = useQuery({ queryKey: ['market', id], queryFn: () => api.get<MarketDto>(`/markets/${id}`) });
  const sections = useQuery({ queryKey: ['sections', id], queryFn: () => api.get<SectionDto[]>(`/markets/${id}/sections`), enabled: !!market.data?.usesSections });
  if (market.isPending) return <Screen title="Market"><LoadingView /></Screen>;
  if (market.isError) return <Screen title="Market"><ErrorState error={market.error} onRetry={() => market.refetch()} /></Screen>;
  const m = market.data;
  return (
    <Screen title={m.name} subtitle={`${m.city}, ${m.region}`}>
      <Card>
        {m.description ? <Body className="mb-2">{m.description}</Body> : null}
        <KeyValue label="Sections" value={String(m.stats?.sections ?? 0)} />
        <KeyValue label="Houses" value={String(m.stats?.houses ?? 0)} />
        <KeyValue label="Active shops" value={String(m.stats?.shops ?? 0)} />
        {m.location ? <Button title="Directions to market" icon={Navigation} variant="secondary" size="sm" className="mt-3 self-start" onPress={() => openInMaps(m.location!.lat, m.location!.lng, m.name)} /> : null}
      </Card>
      {m.usesSections ? (
        <>
          <SectionHeader title="Sections" />
          {sections.data?.map((s) => (
            <Card key={s.id} className="mb-2 flex-row items-center" onPress={() => router.push(`/section/${s.id}`)}>
              <View className="mr-3 h-10 w-10 items-center justify-center rounded-lg bg-brand-50">
                <Text className="font-bold text-brand-800">{s.code}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-ink-900">{s.name}</Text>
                <Text className="text-xs text-ink-500">{s.houseCount ?? 0} houses</Text>
              </View>
              <ChevronRight size={18} color={colors.inkFaint} />
            </Card>
          ))}
        </>
      ) : null}
      <Button title="Browse all houses" variant="outline" className="mt-4" onPress={() => router.push({ pathname: '/houses', params: { marketId: m.id, title: `${m.name} houses` } })} fullWidth />
      <Button title="Browse all shops" variant="outline" className="mt-2" onPress={() => router.push({ pathname: '/shops', params: { marketId: m.id, title: `${m.name} shops` } })} fullWidth />
    </Screen>
  );
}
