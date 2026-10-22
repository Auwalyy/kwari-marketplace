import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react-native';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type ShopDto } from '@kkdm/shared';
import { Button, Card, ChoiceChips, ErrorState, IconButton, LoadingView, Notice, Screen, SectionHeader, SwitchRow, TextField, toast } from '@/components/ui';
import { useAppConfig } from '@/hooks';
import { api } from '@/lib/api';
import { koboToNairaInput, nairaInputToKobo } from '@/lib/format';

interface OptionForm {
  name: string;
  fee: string;
  quoted: boolean;
  estimatedDays: string;
  areas: string;
  active: boolean;
}

/** Pickup, delivery options and accepted payment methods (owner only). */
export default function Fulfilment() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const config = useAppConfig();
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<ShopDto>(`/shops/${shopId}`) });
  const [pickup, setPickup] = useState(true);
  const [pickupInstructions, setPickupInstructions] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [options, setOptions] = useState<OptionForm[]>([]);
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [bank, setBank] = useState('');

  useEffect(() => {
    const s = shop.data;
    if (!s) return;
    setPickup(s.pickupAvailable);
    setPickupInstructions(s.pickupInstructions ?? '');
    setDelivery(s.deliveryAvailable);
    setOptions(s.deliveryOptions.map((o) => ({ name: o.name, fee: koboToNairaInput(o.feeKobo), quoted: o.feeKobo == null, estimatedDays: o.estimatedDays ?? '', areas: o.areas.join(', '), active: o.active })));
    setPayments(s.acceptedPaymentMethods);
    setBank(s.bankTransferInstructions ?? '');
  }, [shop.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put<ShopDto>(`/shops/${shopId}/fulfilment`, {
        pickupAvailable: pickup,
        pickupInstructions: pickupInstructions || undefined,
        deliveryAvailable: delivery,
        deliveryOptions: options.map((o) => ({ name: o.name, feeKobo: o.quoted ? null : (nairaInputToKobo(o.fee) ?? 0), estimatedDays: o.estimatedDays || undefined, areas: o.areas.split(',').map((a) => a.trim()).filter(Boolean), active: o.active })),
        acceptedPaymentMethods: payments,
        bankTransferInstructions: bank || undefined,
      }),
    onSuccess: (s) => {
      qc.setQueryData(['shop', shopId], (old: object | undefined) => ({ ...old, ...s }));
      toast.success('Settings saved');
    },
    onError: (e) => toast.apiError(e),
  });

  if (shop.isPending) return <Screen title="Pickup & delivery"><LoadingView /></Screen>;
  if (shop.isError) return <Screen title="Pickup & delivery"><ErrorState error={shop.error} /></Screen>;
  const setOpt = (i: number, patch: Partial<OptionForm>) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  return (
    <Screen title="Pickup, delivery & payment" footer={<Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!payments.length} fullWidth />}>
      <SectionHeader title="Pickup" />
      <SwitchRow label="Customers can collect at the shop" value={pickup} onChange={setPickup} />
      {pickup ? <TextField label="Pickup instructions" value={pickupInstructions} onChangeText={setPickupInstructions} multiline placeholder="Opening times, who to ask for, what to bring" /> : null}

      <SectionHeader title="Delivery" />
      <SwitchRow label="We deliver" description="Deliver yourself or arrange a courier. You can quote fees per order." value={delivery} onChange={setDelivery} />
      {delivery
        ? options.map((o, i) => (
            <Card key={i} className="mb-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-ink-900">Option {i + 1}</Text>
                <IconButton icon={Trash2} label="Remove option" onPress={() => setOptions((os) => os.filter((_, j) => j !== i))} />
              </View>
              <TextField label="Name" value={o.name} onChangeText={(t) => setOpt(i, { name: t })} placeholder="Within Kano city" />
              <SwitchRow label="Fee is quoted per order" value={o.quoted} onChange={(v) => setOpt(i, { quoted: v })} />
              {!o.quoted ? <TextField label="Fee (₦)" keyboardType="numeric" value={o.fee} onChangeText={(t) => setOpt(i, { fee: t })} /> : null}
              <TextField label="Estimated time" value={o.estimatedDays} onChangeText={(t) => setOpt(i, { estimatedDays: t })} placeholder="1–2 days" />
              <TextField label="Areas covered (comma separated)" value={o.areas} onChangeText={(t) => setOpt(i, { areas: t })} />
              <SwitchRow label="Active" value={o.active} onChange={(v) => setOpt(i, { active: v })} />
            </Card>
          ))
        : null}
      {delivery ? <Button title="Add delivery option" icon={Plus} variant="outline" onPress={() => setOptions((os) => [...os, { name: '', fee: '', quoted: false, estimatedDays: '', areas: '', active: true }])} /> : null}

      <SectionHeader title="Payment methods" />
      <ChoiceChips multiple options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} value={payments} onChange={(v: PaymentMethod[]) => setPayments(v)} />
      {payments.includes('online') && !config.data?.features.onlinePayment.available ? <Notice tone="warning">Online payment isn’t configured on the platform yet, so customers won’t be able to choose it until it is.</Notice> : null}
      {payments.includes('bank_transfer') ? <TextField label="Bank transfer instructions" value={bank} onChangeText={setBank} multiline hint="Shown to customers. Bank transfers are confirmed by you, not verified by the platform." /> : null}
    </Screen>
  );
}
