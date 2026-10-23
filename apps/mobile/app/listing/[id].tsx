import { useRef, useState } from 'react';
import { FlatList, Linking, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone, ShoppingBag, UserRound } from 'lucide-react-native';
import type { ResellerListingDto } from '@kkdm/shared';
import { Body, Button, Card, ErrorState, LoadingView, Notice, Screen, SectionHeader, Sheet, StockIndicator, TextField, toast, type SheetHandle } from '@/components/ui';
import { useRequireAuth } from '@/hooks';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatNaira, formatQuantity, unitLabel } from '@/lib/format';
import { useAuth } from '@/store/auth';

const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `234${d.slice(1)}` : d;
};

/** A product sold by a reseller. Customers deal with the reseller; the supplying shop is not shown. */
export default function ListingPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width, height } = useWindowDimensions();
  const requireAuth = useRequireAuth();
  const me = useAuth((s) => s.user);
  const sheet = useRef<SheetHandle>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState(me?.phone ?? '');
  const q = useQuery({ queryKey: ['listing', id], queryFn: () => api.get<ResellerListingDto>(`/reseller-listings/${id}`) });

  const request = useMutation({
    mutationFn: () => api.post(`/reseller-listings/${id}/requests`, { quantity: Number(qty), note: note || undefined, phone: phone || undefined }),
    onSuccess: () => {
      sheet.current?.close();
      toast.success(`Sent to ${q.data?.reseller.businessName}. They will contact you.`);
    },
    onError: (e) => toast.apiError(e),
  });

  if (q.isPending) return <Screen title=""><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Product"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const l = q.data;
  const r = l.reseller;
  const mine = me?.reseller?.id === r.id;
  const galleryHeight = Math.min(width * 1.1, height * 0.5);

  return (
    <Screen
      title=""
      padded={false}
      footer={
        mine ? undefined : (
          <View className="flex-row">
            {r.phone ? <Button title="Call" icon={Phone} variant="outline" className="mr-2" onPress={() => void Linking.openURL(`tel:${r.phone}`)} /> : null}
            <Button title="I want to buy" icon={ShoppingBag} className="flex-1" disabled={!l.available} onPress={() => requireAuth(() => sheet.current?.open(), 'Sign in so the seller can contact you')} />
          </View>
        )
      }
    >
      <FlatList
        data={l.product.images}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(i) => i.url}
        onMomentumScrollEnd={(e) => setImageIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Image source={{ uri: item.url }} placeholder={{ uri: item.thumbnailUrl }} style={{ width, height: galleryHeight }} contentFit="cover" className="bg-cream-200" />}
      />
      {l.product.images.length > 1 ? (
        <View className="mt-2 flex-row justify-center">
          {l.product.images.map((i, idx) => (
            <View key={i.url} className={`mx-0.5 h-1.5 rounded-full ${idx === imageIndex ? 'w-4 bg-brand-700' : 'w-1.5 bg-cream-300'}`} />
          ))}
        </View>
      ) : null}
      <View className="px-4 pt-3">
        {mine ? <Notice tone="info" title="This is how customers see your product">Your supplier and your profit are hidden from them.</Notice> : null}
        {!l.available ? <Notice tone="warning" title="Not available right now">{l.unavailableReason ?? ''}</Notice> : null}
        <Text className="text-xl font-bold text-ink-900">{l.product.name}</Text>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-ink-900">
            {formatNaira(l.priceKobo)}
            <Text className="text-sm font-normal text-ink-500"> / {unitLabel(l.product.unit)}</Text>
          </Text>
          <StockIndicator status={l.product.stockStatus} />
        </View>
        {l.product.minOrderQuantity > 1 ? <Text className="mt-1 text-xs text-ink-500">Minimum {formatQuantity(l.product.minOrderQuantity, l.product.unit)}</Text> : null}
        {l.note ? <Text className="mt-3 rounded-xl bg-gold-100 p-3 text-sm text-ink-800">{l.note}</Text> : null}

        <Card className="mt-4" onPress={() => router.push(`/r/${r.slug}`)}>
          <View className="flex-row items-center">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-50">
              <UserRound size={20} color={colors.brand} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-base font-semibold text-ink-900">{r.businessName}</Text>
              <Text className="text-xs text-ink-500">{[r.area, `${r.listingCount} product${r.listingCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
          {r.whatsapp || r.phone ? (
            <Button title="WhatsApp" icon={MessageCircle} variant="secondary" size="sm" className="mt-3 self-start" onPress={() => void Linking.openURL(`https://wa.me/${waNumber((r.whatsapp || r.phone)!)}?text=${encodeURIComponent(`Hello, I saw ${l.product.name} at ${formatNaira(l.priceKobo)} on Kantin Kwari.`)}`)} />
          ) : null}
        </Card>

        <SectionHeader title="Details" />
        {l.product.description ? <Body className="mb-2 text-sm leading-5">{l.product.description}</Body> : null}
        {l.product.material ? <Text className="text-sm text-ink-700">Material: {l.product.material}</Text> : null}
        {l.product.colours.length ? <Text className="text-sm text-ink-700">Colours: {l.product.colours.join(', ')}</Text> : null}
        <Text className="mt-4 text-xs leading-5 text-ink-500">You arrange payment and delivery directly with {r.businessName}. Only pay once you have agreed the details.</Text>
      </View>

      <Sheet ref={sheet} title="I want to buy" snapPoints={['70%']}>
        <TextField label={`How many ${unitLabel(l.product.unit, 2)}?`} keyboardType="decimal-pad" value={qty} onChangeText={setQty} hint={Number(qty) > 0 ? `About ${formatNaira(Math.round(l.priceKobo * Number(qty)))}` : undefined} />
        <TextField label="Your phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} hint="So the seller can call you" />
        <TextField label="Message (optional)" value={note} onChangeText={setNote} multiline placeholder="When you need it, delivery area…" />
        <Button title={`Send to ${r.businessName}`} fullWidth loading={request.isPending} disabled={!(Number(qty) > 0)} onPress={() => request.mutate()} />
      </Sheet>
    </Screen>
  );
}
