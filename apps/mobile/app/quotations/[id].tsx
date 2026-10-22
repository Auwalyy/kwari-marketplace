import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, ShoppingCart } from 'lucide-react-native';
import { SOCKET_EVENTS, type QuotationDto } from '@kkdm/shared';
import { Badge, Body, Button, Card, ChoiceChips, Divider, ErrorState, Heading, KeyValue, LoadingView, Screen, SectionHeader, TextField, toast, useConfirm } from '@/components/ui';
import { useShopRole, useSocketEvent } from '@/hooks';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity, nairaInputToKobo } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { QUOTATION_TONE } from '@/features/quotations';

/** Structured negotiation: seller offers, customer accepts / declines / counters, then converts to cart. */
export default function QuotationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['quotations', 'detail', id], queryFn: () => api.get<QuotationDto>(`/quotations/${id}`) });
  const role = useShopRole(q.data?.shop.id);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [validHours, setValidHours] = useState('72');
  const [note, setNote] = useState('');
  useSocketEvent(SOCKET_EVENTS.quotationUpdated, (p: { quotationId: string }) => p.quotationId === id && void q.refetch());

  const done = (data: QuotationDto) => {
    qc.setQueryData(['quotations', 'detail', id], data);
    void qc.invalidateQueries({ queryKey: ['quotations'] });
    setPrices({});
    setNote('');
  };
  const offer = useMutation({
    mutationFn: () => api.post<QuotationDto>(`/quotations/${id}/offer`, { items: q.data!.items.map((i) => ({ itemId: i.id, unitPriceKobo: nairaInputToKobo(prices[i.id] ?? '') ?? i.offeredUnitPriceKobo ?? i.listUnitPriceKobo })), validForHours: Number(validHours) || 72, sellerNote: note || undefined }),
    onSuccess: (d) => { done(d); toast.success('Offer sent'); },
    onError: (e) => toast.apiError(e),
  });
  const respond = useMutation({
    mutationFn: (action: 'accept' | 'reject' | 'counter') =>
      api.post<QuotationDto>(`/quotations/${id}/respond`, {
        action,
        note: note || undefined,
        counterItems: action === 'counter' ? q.data!.items.filter((i) => prices[i.id]).map((i) => ({ itemId: i.id, unitPriceKobo: nairaInputToKobo(prices[i.id])! })) : undefined,
      }),
    onSuccess: (d) => done(d),
    onError: (e) => toast.apiError(e),
  });
  const simple = useMutation({ mutationFn: (path: 'reject' | 'cancel') => api.post<QuotationDto>(`/quotations/${id}/${path}`, { note: note || undefined }), onSuccess: done, onError: (e) => toast.apiError(e) });
  const toCart = useMutation({
    mutationFn: () => api.post(`/quotations/${id}/add-to-cart`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cart'] });
      toast.success(isCustomer ? 'Added to your cart at the agreed price' : 'Added to the customer’s cart');
      if (isCustomer) router.push('/(tabs)/cart');
    },
    onError: (e) => toast.apiError(e),
  });

  if (q.isPending) return <Screen title="Quotation"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Quotation"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const d = q.data;
  const isCustomer = d.customer.id === user?.id;
  const isSeller = !isCustomer && role.can('quotations.manage');
  const open = ['requested', 'countered', 'offered'].includes(d.status);

  return (
    <Screen title={d.reference} subtitle={isCustomer ? d.shop.name : d.customer.fullName} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <Badge label={d.status} tone={QUOTATION_TONE[d.status] ?? 'neutral'} />
          {d.expiresAt && d.status === 'offered' ? <Text className="text-xs text-ink-500">Offer valid until {formatDateTime(d.expiresAt)}</Text> : null}
        </View>
        {d.message ? <Body className="mt-2 text-sm">“{d.message}”</Body> : null}
        {d.sellerNote ? <Text className="mt-2 text-sm text-ink-700">Seller: {d.sellerNote}</Text> : null}
        {d.customerNote ? <Text className="mt-1 text-sm text-ink-700">Customer: {d.customerNote}</Text> : null}
      </Card>

      <SectionHeader title="Items" />
      <Card>
        {d.items.map((i) => (
          <View key={i.id} className="mb-3">
            <Text className="font-semibold text-ink-900">{i.productName}</Text>
            <Text className="text-xs text-ink-500">{formatQuantity(i.quantity, i.unit)} · list {formatNaira(i.listUnitPriceKobo)}</Text>
            {i.targetUnitPriceKobo != null ? <Text className="text-xs text-ink-600">Customer target: {formatNaira(i.targetUnitPriceKobo)}</Text> : null}
            {i.offeredUnitPriceKobo != null ? <Text className="text-sm font-semibold text-brand-700">Offer: {formatNaira(i.offeredUnitPriceKobo)} per unit</Text> : null}
            {(isSeller && open) || (isCustomer && d.status === 'offered') ? (
              <TextField containerClassName="mt-2 mb-0" label={isSeller ? 'Your price per unit (₦)' : 'Counter price per unit (₦, optional)'} keyboardType="numeric" value={prices[i.id] ?? ''} onChangeText={(t) => setPrices((p) => ({ ...p, [i.id]: t }))} />
            ) : null}
          </View>
        ))}
        {d.totalOfferedKobo != null ? (
          <>
            <Divider />
            <KeyValue label="Offered total" value={formatNaira(d.totalOfferedKobo)} strong />
          </>
        ) : null}
      </Card>

      {isSeller && open ? (
        <Card className="mt-3">
          <Heading className="mb-2">Send an offer</Heading>
          <ChoiceChips label="Offer valid for" options={[{ value: '24', label: '24 hours' }, { value: '72', label: '3 days' }, { value: '168', label: '7 days' }]} value={validHours} onChange={(v) => v && setValidHours(v)} />
          <TextField label="Note to customer (optional)" value={note} onChangeText={setNote} multiline />
          <View className="flex-row">
            <Button title="Send offer" className="mr-2 flex-1" onPress={() => offer.mutate()} loading={offer.isPending} disabled={d.items.some((i) => !prices[i.id] && i.offeredUnitPriceKobo == null)} />
            <Button title="Decline" variant="outline" onPress={async () => (await confirm({ title: 'Decline this request?', destructive: true, confirmLabel: 'Decline' })).confirmed && simple.mutate('reject')} />
          </View>
        </Card>
      ) : null}

      {isCustomer && d.status === 'offered' ? (
        <Card className="mt-3">
          <TextField label="Message (optional)" value={note} onChangeText={setNote} multiline />
          <Button title="Accept offer" className="mb-2" onPress={() => respond.mutate('accept')} loading={respond.isPending && respond.variables === 'accept'} fullWidth />
          <View className="flex-row">
            <Button title="Counter" variant="outline" className="mr-2 flex-1" disabled={!Object.values(prices).some(Boolean)} onPress={() => respond.mutate('counter')} loading={respond.isPending && respond.variables === 'counter'} />
            <Button title="Decline" variant="outline" className="flex-1" onPress={() => respond.mutate('reject')} />
          </View>
        </Card>
      ) : null}
      {isCustomer && ['requested', 'countered'].includes(d.status) ? <Button title="Withdraw request" variant="ghost" className="mt-3" onPress={() => simple.mutate('cancel')} /> : null}

      {d.status === 'accepted' && (isCustomer || isSeller) ? (
        <Button title={isCustomer ? 'Add to cart at agreed price' : 'Send to customer’s cart'} icon={ShoppingCart} className="mt-4" onPress={() => toCart.mutate()} loading={toCart.isPending} fullWidth size="lg" />
      ) : null}
      {d.orderId ? <Button title="View order" variant="secondary" className="mt-3" onPress={() => router.push(isCustomer ? `/orders/${d.orderId}` : `/seller/${d.shop.id}/order/${d.orderId}`)} fullWidth /> : null}
      {d.conversationId ? <Button title="Open conversation" icon={MessageCircle} variant="ghost" className="mt-2" onPress={() => router.push(`/chat/${d.conversationId}`)} /> : null}

      <SectionHeader title="History" />
      {d.history.map((h, i) => (
        <Text key={i} className="mb-1 text-xs text-ink-600">
          {formatDateTime(h.at)} · {h.by} · {h.status}
          {h.note ? ` — ${h.note}` : ''}
        </Text>
      ))}
    </Screen>
  );
}
