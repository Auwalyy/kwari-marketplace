import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus } from 'lucide-react-native';
import { PAYMENT_METHOD_LABELS, type AddressDto, type CartDto, type CheckoutResultDto, type FulfilmentMethod, type PaymentMethod } from '@kkdm/shared';
import { Button, Card, ChoiceChips, Divider, ErrorState, Heading, KeyValue, LoadingView, Notice, Screen, SectionHeader, TextField, toast } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { api } from '@/lib/api';
import { formatNaira, uuid } from '@/lib/format';

interface ShopChoice {
  fulfilmentMethod: FulfilmentMethod;
  deliveryOptionId?: string;
  paymentMethod?: PaymentMethod;
  note: string;
}

/**
 * Checkout creates one order per seller. Totals shown here are estimates from the server-priced cart;
 * the API recomputes everything and reserves stock atomically. The idempotency key prevents duplicate
 * orders if the request is retried (e.g. on a flaky connection).
 */
export default function Checkout() {
  const qc = useQueryClient();
  const config = useAppConfig();
  const [idempotencyKey] = useState(uuid);
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.get<CartDto>('/cart') });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => api.get<AddressDto[]>('/users/me/addresses') });
  const [choices, setChoices] = useState<Record<string, ShopChoice>>({});
  const [addressId, setAddressId] = useState<string | undefined>();
  const onlineAvailable = !!config.data?.features.onlinePayment.available;

  useEffect(() => {
    if (!cart.data) return;
    setChoices((prev) => {
      const next = { ...prev };
      for (const g of cart.data.groups) {
        if (next[g.shop.id]) continue;
        const method: FulfilmentMethod = g.shop.pickupAvailable ? 'pickup' : 'delivery';
        const payments = g.shop.acceptedPaymentMethods.filter((m) => (m !== 'online' || onlineAvailable) && (m !== 'cash_on_pickup' || method === 'pickup'));
        next[g.shop.id] = { fulfilmentMethod: method, deliveryOptionId: method === 'delivery' ? g.shop.deliveryOptions[0]?.id : undefined, paymentMethod: payments[0], note: '' };
      }
      return next;
    });
  }, [cart.data, onlineAvailable]);
  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId((addresses.data.find((a) => a.isDefault) ?? addresses.data[0]).id);
  }, [addresses.data, addressId]);

  const set = (shopId: string, patch: Partial<ShopChoice>) => setChoices((c) => ({ ...c, [shopId]: { ...c[shopId], ...patch } }));
  const needsAddress = Object.values(choices).some((c) => c.fulfilmentMethod === 'delivery');

  const totals = useMemo(() => {
    let items = 0;
    let delivery = 0;
    let quoted = false;
    for (const g of cart.data?.groups ?? []) {
      items += g.subtotalKobo;
      const c = choices[g.shop.id];
      if (c?.fulfilmentMethod === 'delivery') {
        const opt = g.shop.deliveryOptions.find((o) => o.id === c.deliveryOptionId);
        if (opt?.feeKobo == null) quoted = true;
        else delivery += opt.feeKobo;
      }
    }
    return { items, delivery, quoted, total: items + delivery };
  }, [cart.data, choices]);

  const place = useMutation({
    mutationFn: () =>
      api.post<CheckoutResultDto>('/checkout', {
        idempotencyKey,
        addressId: needsAddress ? addressId : undefined,
        shops: (cart.data?.groups ?? []).map((g) => ({ shopId: g.shop.id, ...choices[g.shop.id], note: choices[g.shop.id]?.note || undefined })),
      }),
    onSuccess: (res) => {
      qc.setQueryData(['checkout', res.checkoutId], res);
      void qc.invalidateQueries({ queryKey: ['cart'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      router.replace(`/order-confirmation/${res.checkoutId}`);
    },
    onError: (e) => toast.apiError(e),
  });

  if (cart.isPending) return <Screen title="Checkout"><LoadingView /></Screen>;
  if (cart.isError) return <Screen title="Checkout"><ErrorState error={cart.error} onRetry={() => cart.refetch()} /></Screen>;
  const groups = cart.data.groups;
  const incomplete = groups.some((g) => {
    const c = choices[g.shop.id];
    return !c?.paymentMethod || (c.fulfilmentMethod === 'delivery' && !c.deliveryOptionId);
  });

  return (
    <Screen
      title="Checkout"
      footer={
        <View>
          <View className="mb-2 flex-row justify-between">
            <Text className="text-ink-600">Total{totals.quoted ? ' (plus quoted delivery)' : ''}</Text>
            <Text className="text-lg font-bold text-ink-900">{formatNaira(totals.total)}</Text>
          </View>
          <Button title={`Place ${groups.length > 1 ? `${groups.length} orders` : 'order'}`} onPress={() => place.mutate()} loading={place.isPending} disabled={incomplete || (needsAddress && !addressId) || !groups.length} fullWidth size="lg" />
        </View>
      }
    >
      {groups.length > 1 ? <Notice tone="info">Your cart has items from {groups.length} shops. Each shop receives its own order and handles its own pickup or delivery.</Notice> : null}

      {groups.map((g) => {
        const c = choices[g.shop.id];
        if (!c) return null;
        const fulfilment = [
          ...(g.shop.pickupAvailable ? [{ value: 'pickup' as const, label: 'Pick up at shop' }] : []),
          ...(g.shop.deliveryAvailable && g.shop.deliveryOptions.length ? [{ value: 'delivery' as const, label: 'Delivery' }] : []),
        ];
        const payments = g.shop.acceptedPaymentMethods
          .filter((m) => m !== 'cash_on_pickup' || c.fulfilmentMethod === 'pickup')
          .map((m) => ({ value: m, label: m === 'online' && !onlineAvailable ? `${PAYMENT_METHOD_LABELS[m]} (unavailable)` : PAYMENT_METHOD_LABELS[m] }));
        return (
          <Card key={g.shop.id} className="mb-4">
            <Heading>{g.shop.name}</Heading>
            <Text className="mb-3 text-xs text-ink-500">{g.lines.length} item(s) · {formatNaira(g.subtotalKobo)}</Text>
            <ChoiceChips
              label="How will you receive it?"
              options={fulfilment}
              value={c.fulfilmentMethod}
              onChange={(v: FulfilmentMethod | undefined) => {
                if (!v) return;
                set(g.shop.id, { fulfilmentMethod: v, deliveryOptionId: v === 'delivery' ? g.shop.deliveryOptions[0]?.id : undefined, paymentMethod: v === 'delivery' && c.paymentMethod === 'cash_on_pickup' ? undefined : c.paymentMethod });
              }}
            />
            {c.fulfilmentMethod === 'delivery' ? (
              <ChoiceChips
                label="Delivery option"
                options={g.shop.deliveryOptions.map((o) => ({ value: o.id, label: `${o.name} · ${o.feeKobo == null ? 'fee quoted by seller' : formatNaira(o.feeKobo)}` }))}
                value={c.deliveryOptionId}
                onChange={(v) => v && set(g.shop.id, { deliveryOptionId: v })}
              />
            ) : null}
            <ChoiceChips
              label="Payment"
              options={payments}
              value={c.paymentMethod}
              onChange={(v: PaymentMethod | undefined) => {
                if (v === 'online' && !onlineAvailable) return toast.info('Online payment is not available yet.');
                set(g.shop.id, { paymentMethod: v });
              }}
            />
            {c.paymentMethod === 'bank_transfer' ? <Text className="mb-2 text-xs text-ink-500">Arrange the transfer with the seller after they accept your order. Only send money to details provided by the shop in the app chat.</Text> : null}
            {c.paymentMethod === 'online' ? <Text className="mb-2 text-xs text-ink-500">You’ll pay securely through the payment provider once the seller accepts the order.</Text> : null}
            <TextField label="Note to seller (optional)" value={c.note} onChangeText={(t) => set(g.shop.id, { note: t })} multiline maxLength={500} />
          </Card>
        );
      })}

      {needsAddress ? (
        <>
          <SectionHeader title="Delivery address" action="Manage" onAction={() => router.push('/addresses')} />
          {addresses.data?.map((a) => (
            <Pressable key={a.id} onPress={() => setAddressId(a.id)} className={`mb-2 flex-row rounded-2xl border p-3 ${addressId === a.id ? 'border-brand-700 bg-brand-50' : 'border-line bg-white'}`}>
              <MapPin size={18} color="#174F33" />
              <View className="ml-2 flex-1">
                <Text className="font-semibold text-ink-900">{a.label} · {a.recipientName}</Text>
                <Text className="text-sm text-ink-600">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state}</Text>
                <Text className="text-xs text-ink-500">{a.phone}</Text>
              </View>
            </Pressable>
          ))}
          <Button title="Add a new address" icon={Plus} variant="outline" onPress={() => router.push('/addresses/edit')} />
        </>
      ) : null}

      <SectionHeader title="Summary" />
      <Card>
        <KeyValue label="Items" value={formatNaira(totals.items)} />
        <KeyValue label="Delivery" value={totals.quoted ? `${formatNaira(totals.delivery)} + quoted fees` : formatNaira(totals.delivery)} />
        <Divider />
        <KeyValue label="Estimated total" value={formatNaira(totals.total)} strong />
        <Text className="mt-2 text-xs text-ink-500">Prices and stock are confirmed by the server when you place the order. Sellers must accept each order.</Text>
      </Card>
    </Screen>
  );
}
