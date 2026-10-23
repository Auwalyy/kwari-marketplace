import { Linking, Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone, Share2 } from 'lucide-react-native';
import type { PageMeta, ResellerListingDto, ResellerPublicDto } from '@kkdm/shared';
import { Button, EmptyState, ErrorState, IconButton, LoadingView, Screen } from '@/components/ui';
import { ListingCard, resellerShareText } from '@/components/reseller';
import { api } from '@/lib/api';

const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `234${d.slice(1)}` : d;
};

/** A reseller's page: who they are, how to reach them, and everything they sell. */
export default function ResellerPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const q = useQuery({ queryKey: ['reseller-page', slug], queryFn: () => api.get<{ reseller: ResellerPublicDto; listings: ResellerListingDto[]; meta: PageMeta }>(`/resellers/${slug}`, { limit: 60 }) });
  if (q.isPending) return <Screen title=""><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Seller"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const { reseller: r, listings } = q.data;
  return (
    <Screen
      title={r.businessName}
      subtitle={r.area}
      onRefresh={() => void q.refetch()}
      refreshing={q.isRefetching}
      right={<IconButton icon={Share2} label="Share" onPress={() => void Share.share({ message: resellerShareText(r.businessName, r.slug) })} />}
    >
      {r.about ? <Text className="mb-3 text-sm leading-5 text-ink-700">{r.about}</Text> : null}
      <View className="mb-4 flex-row">
        {r.phone ? <Button title="Call" icon={Phone} variant="outline" size="sm" className="mr-2" onPress={() => void Linking.openURL(`tel:${r.phone}`)} /> : null}
        {r.whatsapp || r.phone ? <Button title="WhatsApp" icon={MessageCircle} variant="secondary" size="sm" onPress={() => void Linking.openURL(`https://wa.me/${waNumber((r.whatsapp || r.phone)!)}`)} /> : null}
      </View>
      {listings.length ? (
        <View className="flex-row flex-wrap justify-between">
          {listings.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </View>
      ) : (
        <EmptyState title="Nothing for sale yet" message="Check back soon." />
      )}
    </Screen>
  );
}
