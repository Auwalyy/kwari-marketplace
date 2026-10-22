import { Linking, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Navigation, Phone } from 'lucide-react-native';
import type { HouseDto, ShopSummaryDto } from '@kkdm/shared';
import { Body, Button, Card, ErrorState, Heading, LoadingView, LocationBreadcrumbView, Screen, SectionHeader, VerificationBadge } from '@/components/ui';
import { ShopCard } from '@/components/cards';
import { openInMaps } from '@/components/directory';
import { api } from '@/lib/api';

export default function HouseDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const house = useQuery({ queryKey: ['house', id], queryFn: () => api.get<HouseDto>(`/houses/${id}`) });
  const shops = useQuery({ queryKey: ['shops', { houseId: id }], queryFn: () => api.page<ShopSummaryDto>('/shops', { houseId: id, limit: 50, sort: 'name' }) });
  if (house.isPending) return <Screen title="House"><LoadingView /></Screen>;
  if (house.isError) return <Screen title="House"><ErrorState error={house.error} onRetry={() => house.refetch()} /></Screen>;
  const h = house.data;
  return (
    <Screen title={`House ${h.houseNumber}`} subtitle={h.name} onRefresh={() => { void house.refetch(); void shops.refetch(); }} refreshing={house.isRefetching}>
      <Card className="mb-2">
        <View className="flex-row items-start justify-between">
          <Heading className="flex-1">{h.name}</Heading>
          <VerificationBadge status={h.verificationStatus} />
        </View>
        <View className="mt-2">
          <LocationBreadcrumbView breadcrumb={h.breadcrumb} />
        </View>
        <View className="mt-3 flex-row">
          <MapPin size={16} color="#6B7069" />
          <Body className="ml-2 flex-1 text-sm">{h.addressDescription}</Body>
        </View>
        {h.description ? <Body className="mt-2 text-sm">{h.description}</Body> : null}
        <View className="mt-3 flex-row flex-wrap">
          {h.location ? <Button title="Directions" icon={Navigation} size="sm" variant="secondary" className="mb-2 mr-2" onPress={() => openInMaps(h.location!.lat, h.location!.lng, h.name)} /> : null}
          {h.contactPhone ? <Button title="Call house office" icon={Phone} size="sm" variant="outline" className="mb-2" onPress={() => void Linking.openURL(`tel:${h.contactPhone}`)} /> : null}
        </View>
      </Card>
      <SectionHeader title={`Shops in this house (${shops.data?.meta.total ?? h.shopCount})`} action="Search products" onAction={() => router.push({ pathname: '/search', params: { houseId: h.id, title: `House ${h.houseNumber}` } })} />
      {shops.data?.items.map((s) => <ShopCard key={s.id} shop={s} />)}
      {shops.data && !shops.data.items.length ? <Text className="text-sm text-ink-500">No shops are listed in this house yet.</Text> : null}
    </Screen>
  );
}
