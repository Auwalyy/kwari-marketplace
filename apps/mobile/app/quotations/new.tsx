import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react-native';
import type { ProductDto, ProductSummaryDto, QuotationDto } from '@kkdm/shared';
import { Body, Button, Card, Chip, Heading, Notice, QuantityStepper, Screen, SectionHeader, TextField, toast } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatNaira, nairaInputToKobo, unitLabel } from '@/lib/format';

interface Line {
  product: ProductSummaryDto | ProductDto;
  variantId?: string;
  quantity: number;
  target: string;
}

/** Request a (wholesale) quotation: quantities and optional target prices; the seller replies with an offer. */
export default function NewQuotation() {
  const { shopId, productId } = useLocalSearchParams<{ shopId: string; productId?: string }>();
  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState('');
  const [picking, setPicking] = useState(false);
  const initial = useQuery({ queryKey: ['product', productId], queryFn: () => api.get<ProductDto>(`/products/${productId}`), enabled: !!productId });
  const catalogue = useQuery({ queryKey: ['shop-products', shopId, 'quote'], queryFn: () => api.page<ProductSummaryDto>('/search/products', { shopId, limit: 50, sort: 'newest' }), enabled: picking });

  useEffect(() => {
    if (initial.data && !lines.length) setLines([{ product: initial.data, quantity: initial.data.wholesaleMinQuantity ?? initial.data.minOrderQuantity ?? 1, target: '' }]);
  }, [initial.data, lines.length]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<QuotationDto>('/quotations', {
        shopId,
        message: message || undefined,
        items: lines.map((l) => ({ productId: l.product.id, variantId: l.variantId ?? null, quantity: l.quantity, targetUnitPriceKobo: l.target ? (nairaInputToKobo(l.target) ?? undefined) : undefined })),
      }),
    onSuccess: (q) => {
      toast.success('Quotation request sent');
      router.replace(`/quotations/${q.id}`);
    },
    onError: (e) => toast.apiError(e),
  });

  const missingVariant = lines.some((l) => 'variants' in l.product && l.product.variants.length > 0 && !l.variantId);

  return (
    <Screen title="Request a quotation" footer={<Button title="Send request" onPress={() => submit.mutate()} loading={submit.isPending} disabled={!lines.length || missingVariant} fullWidth size="lg" />}>
      <Notice tone="info">Ask the seller for a price on larger quantities. You’ll be notified when they reply, and can accept, decline or counter.</Notice>
      {lines.map((l, i) => (
        <Card key={`${l.product.id}-${i}`} className="mb-3">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Heading className="text-base">{l.product.name}</Heading>
              <Text className="text-xs text-ink-500">List price {formatNaira(l.product.retailPriceKobo)} / {unitLabel(l.product.unit)}</Text>
            </View>
            <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove">
              <Trash2 size={18} color={colors.inkFaint} />
            </Pressable>
          </View>
          {'variants' in l.product && l.product.variants.length ? (
            <View className="mt-2 flex-row flex-wrap">
              {l.product.variants.map((v) => (
                <Chip key={v.id} label={v.label} selected={l.variantId === v.id} onPress={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, variantId: v.id } : x)))} />
              ))}
            </View>
          ) : null}
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="text-sm text-ink-700">Quantity ({unitLabel(l.product.unit, 2)})</Text>
            <QuantityStepper value={l.quantity} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} />
          </View>
          <TextField containerClassName="mt-3 mb-0" label="Your target price per unit (₦, optional)" keyboardType="numeric" value={l.target} onChangeText={(t) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, target: t } : x)))} />
        </Card>
      ))}
      <Button title="Add another product" icon={Plus} variant="outline" onPress={() => setPicking((p) => !p)} />
      {picking ? (
        <>
          <SectionHeader title="Products from this shop" />
          {catalogue.data?.items
            .filter((p) => !lines.some((l) => l.product.id === p.id))
            .map((p) => (
              <Pressable
                key={p.id}
                onPress={async () => {
                  const full = await api.get<ProductDto>(`/products/${p.id}`);
                  setLines((ls) => [...ls, { product: full, quantity: full.wholesaleMinQuantity ?? full.minOrderQuantity ?? 1, target: '' }]);
                  setPicking(false);
                }}
                className="border-b border-line py-3"
              >
                <Text className="text-sm font-semibold text-ink-900">{p.name}</Text>
                <Text className="text-xs text-ink-500">{formatNaira(p.retailPriceKobo)} / {unitLabel(p.unit)}</Text>
              </Pressable>
            ))}
        </>
      ) : null}
      <TextField containerClassName="mt-4" label="Message to the seller (optional)" multiline value={message} onChangeText={setMessage} placeholder="Delivery timeline, colours, etc." />
      {!lines.length && !productId ? <Body className="text-sm">Add at least one product.</Body> : null}
    </Screen>
  );
}
