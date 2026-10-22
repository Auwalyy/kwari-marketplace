import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductSummaryDto, PromotionType } from '@kkdm/shared';
import { Badge, Button, Card, ChoiceChips, KeyValue, Notice, Screen, SectionHeader, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Promo { id: string; type: PromotionType; status: string; startsAt: string; endsAt: string; impressions: number; clicks: number; billing: string; reviewNote?: string; keywords: string[] }
interface PromoData { promotions: Promo[]; plan: string; entitlements: { id: string; plan: string; status: string; endsAt: string | null }[]; paymentsAvailable: boolean }

const TYPES = [
  { value: 'featured_shop', label: 'Featured shop (home screen)' },
  { value: 'featured_product', label: 'Featured product' },
  { value: 'sponsored_search', label: 'Sponsored search result' },
];

/** Request promotions. Paid checkout for promotions is not live yet; administrators arrange billing. */
export default function Promotions() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['promotions', shopId], queryFn: () => api.get<PromoData>(`/promotions/shop/${shopId}`) });
  const products = useQuery({ queryKey: ['shop-products', shopId, 'promo'], queryFn: () => api.page<ProductSummaryDto>('/search/products', { shopId, limit: 50, sort: 'newest' }) });
  const [type, setType] = useState<PromotionType>('featured_shop');
  const [productId, setProductId] = useState<string | undefined>();
  const [keywords, setKeywords] = useState('');
  const [weeks, setWeeks] = useState('1');
  const submit = useMutation({
    mutationFn: () => {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + Number(weeks) * 7 * 86_400_000);
      return api.post('/promotions', { type, shopId, productId: type === 'featured_shop' ? undefined : productId, keywords: keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean), startsAt, endsAt });
    },
    onSuccess: () => {
      toast.success('Request sent for approval');
      void qc.invalidateQueries({ queryKey: ['promotions', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Promotions" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Notice tone="info">Promotion requests are reviewed by administrators. Online payment for promotions isn’t available yet; the team will contact you about any fees. Sponsored placements are always labelled “Sponsored”.</Notice>
      <Card className="mb-4">
        <KeyValue label="Current plan" value={q.data?.plan ?? '—'} />
      </Card>
      <ChoiceChips label="Promotion type" options={TYPES} value={type} onChange={(v) => v && setType(v)} />
      {type !== 'featured_shop' ? <ChoiceChips label="Product" options={(products.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))} value={productId} onChange={setProductId} /> : null}
      {type === 'sponsored_search' ? <TextField label="Search keywords (comma separated)" value={keywords} onChangeText={setKeywords} placeholder="lace, asoebi" /> : null}
      <ChoiceChips label="Duration" options={[{ value: '1', label: '1 week' }, { value: '2', label: '2 weeks' }, { value: '4', label: '4 weeks' }]} value={weeks} onChange={(v) => v && setWeeks(v)} />
      <Button title="Request promotion" onPress={() => submit.mutate()} loading={submit.isPending} disabled={(type !== 'featured_shop' && !productId) || (type === 'sponsored_search' && !keywords.trim())} fullWidth />

      <SectionHeader title="Your promotions" />
      {q.data?.promotions.length ? (
        q.data.promotions.map((p) => (
          <Card key={p.id} className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{TYPES.find((t) => t.value === p.type)?.label}</Text>
              <Badge label={p.status} tone={p.status === 'approved' || p.status === 'active' ? 'success' : p.status === 'pending' ? 'warning' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">{formatDate(p.startsAt)} – {formatDate(p.endsAt)}</Text>
            <Text className="mt-1 text-xs text-ink-600">Measured: {p.impressions} impressions · {p.clicks} taps</Text>
            {p.reviewNote ? <Text className="mt-1 text-xs text-ink-600">Note: {p.reviewNote}</Text> : null}
          </Card>
        ))
      ) : (
        <Text className="text-sm text-ink-500">No promotions yet.</Text>
      )}
    </Screen>
  );
}
