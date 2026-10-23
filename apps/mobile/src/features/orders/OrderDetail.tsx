import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, MapPin, MessageCircle, Phone, Star, Truck } from 'lucide-react-native';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS, SOCKET_EVENTS, type ConversationDto, type OrderDto, type OrderStatus, type PaymentDto } from '@kkdm/shared';
import { Body, Button, Card, Divider, ErrorState, Heading, KeyValue, LoadingView, LocationBreadcrumbView, Notice, OrderStatusBadge, PaymentStatusBadge, Screen, SectionHeader, TextField, toast, useConfirm } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useAppConfig, useSocketEvent } from '@/hooks';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity, koboToNairaInput, nairaInputToKobo } from '@/lib/format';

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: 'Accept order',
  rejected: 'Reject',
  processing: 'Start processing',
  ready: 'Mark ready',
  dispatched: 'Mark dispatched',
  delivered: 'Mark delivered / collected',
  completed: 'Confirm received',
  cancelled: 'Cancel order',
  disputed: 'Report a problem',
};
const NEEDS_REASON: OrderStatus[] = ['rejected', 'cancelled', 'disputed'];

/** Order details and tracking for both customers and shop staff. Transitions are validated by the API. */
export function OrderDetail({ orderId, shopId }: { orderId: string; shopId?: string }) {
  const seller = !!shopId;
  const base = seller ? `/shops/${shopId}/orders/${orderId}` : `/orders/${orderId}`;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const config = useAppConfig();
  const q = useQuery({ queryKey: [seller ? 'shop-orders' : 'orders', 'detail', orderId], queryFn: () => api.get<OrderDto>(base) });
  const payments = useQuery({ queryKey: ['payments', orderId], queryFn: () => api.get<(PaymentDto & { method: string; note?: string })[]>(`/payments/order/${orderId}`) });
  const [delivery, setDelivery] = useState<{ fee?: string; eta?: string; provider?: string; note?: string }>({});

  useSocketEvent(SOCKET_EVENTS.orderUpdated, (p: { orderId: string }) => {
    if (p.orderId === orderId) {
      void q.refetch();
      void payments.refetch();
    }
  });

  const refresh = (o: OrderDto) => {
    qc.setQueryData([seller ? 'shop-orders' : 'orders', 'detail', orderId], o);
    void qc.invalidateQueries({ queryKey: [seller ? 'shop-orders' : 'orders'] });
    void payments.refetch();
  };
  const transition = useMutation({
    mutationFn: (body: { status: OrderStatus; reason?: string; deliveryFeeKobo?: number; estimatedDelivery?: string; trackingNote?: string }) => api.post<OrderDto>(`${base}/transition`, body),
    onSuccess: (o) => {
      refresh(o);
      toast.success(ORDER_STATUS_LABELS[o.status]);
    },
    onError: (e) => toast.apiError(e),
  });
  const updateDelivery = useMutation({
    mutationFn: () => api.patch<OrderDto>(`${base}/delivery`, { feeKobo: delivery.fee ? (nairaInputToKobo(delivery.fee) ?? undefined) : undefined, estimatedDelivery: delivery.eta || undefined, provider: delivery.provider || undefined, note: delivery.note || undefined }),
    onSuccess: (o) => {
      refresh(o);
      setDelivery({});
      toast.success('Delivery details updated');
    },
    onError: (e) => toast.apiError(e),
  });
  const confirmPayment = useMutation({
    mutationFn: (note?: string) => api.post<OrderDto>(`${base}/confirm-payment`, { note }),
    onSuccess: (o) => {
      refresh(o);
      toast.success('Payment recorded as confirmed by you');
    },
    onError: (e) => toast.apiError(e),
  });
  const chat = useMutation({
    mutationFn: () => api.post<ConversationDto>('/conversations', { shopId: q.data!.shop.id }),
    onSuccess: (c) => router.push(`/chat/${c.id}`),
    onError: (e) => toast.apiError(e),
  });

  if (q.isPending) return <Screen title="Order"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Order"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const o = q.data;
  const actions = o.allowedTransitions.filter((s) => s !== 'refund_pending' && s !== 'refunded');
  const awaitingQuote = o.delivery?.status === 'awaiting_quote';

  const runAction = async (status: OrderStatus) => {
    if (status === 'accepted' && seller && awaitingQuote && !delivery.fee) {
      toast.info('Enter the delivery fee below before accepting.');
      return;
    }
    const needsReason = NEEDS_REASON.includes(status);
    const r = await confirm({
      title: `${ACTION_LABEL[status] ?? ORDER_STATUS_LABELS[status]}?`,
      message: status === 'completed' ? 'Confirm you received everything in good condition. This lets you leave a review.' : status === 'delivered' && o.fulfilmentMethod === 'pickup' ? 'Confirm the customer collected the order.' : undefined,
      confirmLabel: ACTION_LABEL[status] ?? 'Confirm',
      destructive: needsReason,
      reason: needsReason ? { placeholder: 'Reason (shared with the other party)', required: true } : undefined,
    });
    if (!r.confirmed) return;
    transition.mutate({ status, reason: r.reason, deliveryFeeKobo: status === 'accepted' && delivery.fee ? (nairaInputToKobo(delivery.fee) ?? undefined) : undefined, estimatedDelivery: delivery.eta || undefined });
  };

  const canPayOnline = !seller && o.paymentMethod === 'online' && ['accepted', 'processing', 'ready', 'dispatched', 'delivered'].includes(o.status) && !['paid', 'refunded', 'refund_pending'].includes(o.paymentStatus);

  return (
    <Screen title={o.reference} subtitle={seller ? o.customer.fullName : o.shop.name} onRefresh={() => { void q.refetch(); void payments.refetch(); }} refreshing={q.isRefetching}>
      {seller && o.reseller ? (
        <Notice tone="info" title="Reseller order">
          {o.reseller.businessName} is an approved reseller. They bought at your reseller price to sell on to their own customer.
        </Notice>
      ) : null}
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <OrderStatusBadge status={o.status} />
          <PaymentStatusBadge status={o.paymentStatus} />
        </View>
        <Text className="mt-2 text-xs text-ink-500">Placed {formatDateTime(o.createdAt)}</Text>
        {o.status === 'pending_acceptance' && !seller ? <Body className="mt-2 text-sm">Waiting for the seller to accept. You can cancel until then.</Body> : null}
      </Card>

      {canPayOnline ? (
        <Card className="mb-3 border-brand-300 bg-brand-50">
          <Text className="mb-2 font-semibold text-brand-800">Ready for payment: {formatNaira(o.totalKobo)}</Text>
          {config.data?.features.onlinePayment.available ? (
            <Button title="Pay online" icon={CreditCard} onPress={() => router.push(`/payment/${o.id}`)} fullWidth />
          ) : (
            <Text className="text-sm text-ink-600">Online payment is not available right now. Contact the seller to arrange another method.</Text>
          )}
        </Card>
      ) : null}
      {!seller && o.paymentMethod === 'bank_transfer' && o.paymentStatus === 'unpaid' && o.status !== 'pending_acceptance' ? (
        <Notice tone="warning" title="Bank transfer">Agree transfer details with the seller in the in-app chat. Your order shows “Paid” only after the seller confirms receiving it. A chat message is not proof of payment.</Notice>
      ) : null}

      {seller && actions.length ? (
        <Card className="mb-3">
          <Heading className="mb-2">Update order</Heading>
          {awaitingQuote && actions.includes('accepted') ? (
            <TextField label="Delivery fee (₦) — required to accept" keyboardType="numeric" value={delivery.fee ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, fee: t }))} />
          ) : null}
          {o.fulfilmentMethod === 'delivery' && (actions.includes('dispatched') || actions.includes('accepted')) ? (
            <TextField label="Estimated delivery window (optional)" placeholder="e.g. Tomorrow, 2–5pm" value={delivery.eta ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, eta: t }))} />
          ) : null}
          <View className="flex-row flex-wrap">
            {actions.map((s) => (
              <Button key={s} title={ACTION_LABEL[s] ?? ORDER_STATUS_LABELS[s]} variant={NEEDS_REASON.includes(s) ? 'outline' : 'primary'} size="sm" className="mb-2 mr-2" loading={transition.isPending && transition.variables?.status === s} onPress={() => void runAction(s)} />
            ))}
          </View>
        </Card>
      ) : null}
      {!seller && actions.length ? (
        <View className="mb-3 flex-row flex-wrap">
          {actions.map((s) => (
            <Button key={s} title={ACTION_LABEL[s] ?? ORDER_STATUS_LABELS[s]} variant={s === 'completed' ? 'primary' : 'outline'} size="sm" className="mb-2 mr-2" loading={transition.isPending && transition.variables?.status === s} onPress={() => void runAction(s)} />
          ))}
        </View>
      ) : null}
      {o.reviewable ? <Button title="Write a review" icon={Star} variant="secondary" className="mb-3" onPress={() => router.push({ pathname: '/reviews/new', params: { orderId: o.id } })} fullWidth /> : null}

      <SectionHeader title="Items" />
      <Card>
        {o.items.map((i) => (
          <Pressable key={i.id} onPress={() => router.push(`/product/${i.productId}`)} className="mb-3 flex-row">
            <View className="h-14 w-14 overflow-hidden rounded-lg bg-cream-200">{i.thumbnailUrl ? <Image source={{ uri: i.thumbnailUrl }} style={{ width: 56, height: 56 }} /> : null}</View>
            <View className="ml-3 flex-1">
              <Text className="text-sm font-semibold text-ink-900">{i.productName}</Text>
              {i.variantLabel ? <Text className="text-xs text-ink-500">{i.variantLabel}</Text> : null}
              <Text className="text-xs text-ink-600">
                {formatQuantity(i.quantity, i.unit)} × {formatNaira(i.unitPriceKobo)}
                {i.wholesaleApplied ? ' (wholesale)' : ''}
              </Text>
            </View>
            <Text className="font-semibold text-ink-900">{formatNaira(i.lineTotalKobo)}</Text>
          </Pressable>
        ))}
        <Divider />
        <KeyValue label="Subtotal" value={formatNaira(o.subtotalKobo)} />
        <KeyValue label="Delivery" value={awaitingQuote ? 'Awaiting seller quote' : formatNaira(o.deliveryFeeKobo)} />
        <KeyValue label="Total" value={formatNaira(o.totalKobo)} strong />
        <KeyValue label="Payment method" value={PAYMENT_METHOD_LABELS[o.paymentMethod]} />
        {o.note ? <KeyValue label="Customer note" value={o.note} /> : null}
      </Card>

      <SectionHeader title={o.fulfilmentMethod === 'pickup' ? 'Pickup' : 'Delivery'} />
      <Card>
        {o.fulfilmentMethod === 'pickup' ? (
          <>
            <LocationBreadcrumbView breadcrumb={o.shop.breadcrumb} />
            {o.delivery?.pickupInstructions ? <Body className="mt-2 text-sm">{o.delivery.pickupInstructions}</Body> : null}
            <Text className="mt-2 text-xs text-ink-500">Bring your order reference {o.reference}.</Text>
          </>
        ) : (
          <>
            <View className="flex-row items-center">
              <Truck size={16} color={colors.brand} />
              <Text className="ml-2 font-semibold text-ink-900">{o.delivery?.optionName ?? 'Delivery'}</Text>
            </View>
            {o.delivery?.address ? (
              <View className="mt-2 flex-row">
                <MapPin size={14} color={colors.inkMuted} />
                <Text className="ml-1.5 flex-1 text-sm text-ink-700">
                  {o.delivery.address.recipientName}, {o.delivery.address.line1}
                  {o.delivery.address.line2 ? `, ${o.delivery.address.line2}` : ''}, {o.delivery.address.city}, {o.delivery.address.state}
                  {o.delivery.address.landmark ? ` (near ${o.delivery.address.landmark})` : ''} · {o.delivery.address.phone}
                </Text>
              </View>
            ) : null}
            {o.delivery?.estimatedDelivery ? <KeyValue label="Estimated" value={o.delivery.estimatedDelivery} /> : <Text className="mt-2 text-xs text-ink-500">No delivery estimate yet. Live GPS tracking isn’t available; updates come from the seller.</Text>}
            {o.delivery?.provider && o.delivery.provider !== 'self' ? <KeyValue label="Courier" value={o.delivery.provider} /> : null}
          </>
        )}
        {o.delivery?.history.length ? (
          <>
            <Divider />
            {o.delivery.history.map((h, i) => (
              <Text key={i} className="mb-1 text-xs text-ink-600">
                {formatDateTime(h.at)} · {h.status.replace(/_/g, ' ')}
                {h.note ? ` — ${h.note}` : ''}
              </Text>
            ))}
          </>
        ) : null}
      </Card>

      {seller && o.fulfilmentMethod === 'delivery' && !['delivered', 'completed', 'cancelled', 'rejected', 'refunded'].includes(o.status) ? (
        <Card className="mt-3">
          <Heading className="mb-2">Delivery details</Heading>
          {!['paid', 'pending', 'seller_confirmed'].includes(o.paymentStatus) && !['dispatched'].includes(o.status) ? (
            <TextField label="Delivery fee (₦)" keyboardType="numeric" placeholder={koboToNairaInput(o.deliveryFeeKobo)} value={delivery.fee ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, fee: t }))} />
          ) : null}
          <TextField label="Estimated window" value={delivery.eta ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, eta: t }))} placeholder="e.g. Friday morning" />
          <TextField label="Courier / delivery service (blank = you deliver)" value={delivery.provider ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, provider: t }))} />
          <TextField label="Note for the customer" value={delivery.note ?? ''} onChangeText={(t) => setDelivery((d) => ({ ...d, note: t }))} />
          <Button title="Save delivery details" variant="secondary" onPress={() => updateDelivery.mutate()} loading={updateDelivery.isPending} disabled={!delivery.fee && !delivery.eta && !delivery.provider && !delivery.note} />
        </Card>
      ) : null}

      <SectionHeader title="Payments" />
      <Card>
        {payments.data?.length ? (
          payments.data.map((p) => (
            <View key={p.id} className="mb-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-ink-900">{formatNaira(p.amountKobo)} · {p.provider === 'manual' ? 'Recorded by seller' : p.provider}</Text>
                <PaymentStatusBadge status={p.status} />
              </View>
              <Text className="text-xs text-ink-500">
                {formatDateTime(p.createdAt)}
                {p.verified ? ' · verified with payment provider' : p.status === 'seller_confirmed' ? ' · confirmed by the seller, not independently verified' : ''}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-sm text-ink-500">No payment recorded yet.</Text>
        )}
        {seller && o.paymentMethod !== 'online' && !['seller_confirmed', 'paid'].includes(o.paymentStatus) && !['cancelled', 'rejected'].includes(o.status) ? (
          <Button
            title="I received this payment"
            variant="secondary"
            size="sm"
            className="mt-2 self-start"
            loading={confirmPayment.isPending}
            onPress={async () => {
              const r = await confirm({ title: 'Confirm payment received?', message: `Only confirm once ${formatNaira(o.totalKobo)} is actually in your account or hand.`, reason: { placeholder: 'Optional note (e.g. transfer reference)' }, confirmLabel: 'Confirm received' });
              if (r.confirmed) confirmPayment.mutate(r.reason);
            }}
          />
        ) : null}
      </Card>

      <SectionHeader title="History" />
      <Card>
        {o.events.map((e, i) => (
          <View key={i} className="mb-2 flex-row">
            <View className="mr-3 mt-1.5 h-2 w-2 rounded-full bg-brand-500" />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-ink-900">{ORDER_STATUS_LABELS[e.status]}</Text>
              <Text className="text-xs text-ink-500">
                {formatDateTime(e.at)} · {e.actorRole}
                {e.note ? ` — ${e.note}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <View className="mt-4 flex-row flex-wrap">
        {!seller ? <Button title="Chat with shop" icon={MessageCircle} variant="outline" size="sm" className="mb-2 mr-2" onPress={() => chat.mutate()} loading={chat.isPending} /> : null}
        {seller && o.customer.phone ? <Button title="Call customer" icon={Phone} variant="outline" size="sm" className="mb-2 mr-2" onPress={() => void Linking.openURL(`tel:${o.customer.phone}`)} /> : null}
        <Button title="Report a problem" variant="ghost" size="sm" className="mb-2" onPress={() => router.push({ pathname: '/report', params: { targetType: 'order', targetId: o.id, label: o.reference } })} />
      </View>
    </Screen>
  );
}
