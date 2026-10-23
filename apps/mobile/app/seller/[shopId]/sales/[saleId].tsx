import { useRef, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HandCoins, Plus, Share2, XCircle } from 'lucide-react-native';
import { SALE_PAYMENT_METHODS, SALE_PAYMENT_METHOD_LABELS, type SalePaymentMethod, type ShopSaleDto } from '@kkdm/shared';
import { Badge, Button, Card, Chip, Divider, ErrorState, KeyValue, LoadingView, Notice, Screen, SectionHeader, Sheet, TextField, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { useStaffShop } from '@/components/seller';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity, koboToNairaInput, nairaInputToKobo, unitLabel } from '@/lib/format';

/** One sale: what was bought, how it was paid, what is still owed. */
export default function SaleDetail() {
  const { shopId, saleId, fresh } = useLocalSearchParams<{ shopId: string; saleId: string; fresh?: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const shop = useStaffShop(shopId);
  const paySheet = useRef<SheetHandle>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('cash');
  const q = useQuery({ queryKey: ['books', shopId, 'sale', saleId], queryFn: () => api.get<ShopSaleDto>(`/shops/${shopId}/books/sales/${saleId}`) });

  const refresh = (s: ShopSaleDto) => {
    qc.setQueryData(['books', shopId, 'sale', saleId], s);
    void qc.invalidateQueries({ queryKey: ['books', shopId] });
    void qc.invalidateQueries({ queryKey: ['inventory', shopId] });
  };
  const pay = useMutation({
    mutationFn: () => api.post<ShopSaleDto>(`/shops/${shopId}/books/sales/${saleId}/payments`, { amountKobo: nairaInputToKobo(amount), method }),
    onSuccess: (s) => {
      refresh(s);
      paySheet.current?.close();
      setAmount('');
      toast.success(s.balanceKobo > 0 ? `Payment saved — still owes ${formatNaira(s.balanceKobo)}` : 'Fully paid');
    },
    onError: (e) => toast.apiError(e),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<ShopSaleDto>(`/shops/${shopId}/books/sales/${saleId}/void`, { reason }),
    onSuccess: (s) => {
      refresh(s);
      toast.success('Sale cancelled and stock put back');
    },
    onError: (e) => toast.apiError(e),
  });

  if (q.isPending) return <Screen title="Sale"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Sale"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const s = q.data;
  const voided = s.status === 'voided';

  const receipt = () =>
    [
      `${shop.data?.name ?? 'Receipt'} — ${s.number}`,
      formatDateTime(s.soldAt),
      s.customerName ? `Customer: ${s.customerName}` : '',
      '',
      ...s.items.map((i) => `${formatQuantity(i.quantity, i.unit)} ${i.name} @ ${formatNaira(i.unitPriceKobo)} = ${formatNaira(i.lineTotalKobo)}`),
      s.discountKobo ? `Discount: -${formatNaira(s.discountKobo)}` : '',
      `Total: ${formatNaira(s.totalKobo)}`,
      `Paid: ${formatNaira(s.amountPaidKobo)}`,
      s.balanceKobo ? `Balance owed: ${formatNaira(s.balanceKobo)}` : 'Fully paid. Thank you!',
    ]
      .filter((x) => x !== '')
      .join('\n');

  return (
    <Screen
      title={`Sale ${s.number}`}
      subtitle={formatDateTime(s.soldAt)}
      footer={
        !voided ? (
          <View className="flex-row">
            <Button title="Share receipt" icon={Share2} variant="outline" className="mr-2 flex-1" onPress={() => void Share.share({ message: receipt() })} />
            {s.balanceKobo > 0 && shop.can('sales.record') ? (
              <Button
                title="Receive payment"
                icon={HandCoins}
                className="flex-1"
                onPress={() => {
                  setAmount(koboToNairaInput(s.balanceKobo));
                  paySheet.current?.open();
                }}
              />
            ) : fresh ? (
              <Button title="Record another" icon={Plus} className="flex-1" onPress={() => router.replace(`/seller/${shopId}/sales/new` as never)} />
            ) : null}
          </View>
        ) : undefined
      }
    >
      {fresh && !voided ? (
        <View className="mb-2 mt-1 flex-row items-center rounded-2xl bg-brand-50 p-3">
          <CheckCircle2 size={22} color={colors.brand} />
          <Text className="ml-2 flex-1 text-sm font-semibold text-brand-800">Sale saved. Stock and your money figures are updated.</Text>
        </View>
      ) : null}
      {voided ? <Notice tone="warning" title="This sale was cancelled">{s.voidReason ?? ''}</Notice> : null}

      <Card className="mt-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-base font-semibold text-ink-900">{s.customerName ?? 'Walk-in customer'}</Text>
          {voided ? <Badge label="Cancelled" tone="neutral" /> : s.balanceKobo > 0 ? <Badge label="On credit" tone="warning" /> : <Badge label="Paid" tone="success" />}
        </View>
        {s.customerPhone ? <Text className="text-sm text-ink-500">{s.customerPhone}</Text> : null}
        <Divider />
        {s.items.map((i, idx) => (
          <View key={idx} className="mb-2">
            <Text className="text-sm font-medium text-ink-900">{i.name}</Text>
            <View className="flex-row justify-between">
              <Text className="text-xs text-ink-500">
                {formatQuantity(i.quantity, i.unit)} × {formatNaira(i.unitPriceKobo)} / {unitLabel(i.unit)}
              </Text>
              <Text className="text-sm text-ink-800">{formatNaira(i.lineTotalKobo)}</Text>
            </View>
          </View>
        ))}
        <Divider />
        {s.discountKobo ? <KeyValue label="Discount" value={`−${formatNaira(s.discountKobo)}`} /> : null}
        <KeyValue label="Total" value={formatNaira(s.totalKobo)} strong />
        <KeyValue label="Paid" value={formatNaira(s.amountPaidKobo)} />
        {s.balanceKobo > 0 ? <KeyValue label="Still owed" value={<Text className="text-sm font-bold text-warning-500">{formatNaira(s.balanceKobo)}</Text>} /> : null}
      </Card>

      {s.payments.length ? (
        <>
          <SectionHeader title="Payments" />
          <Card>
            {s.payments.map((p, idx) => (
              <KeyValue key={idx} label={`${formatDateTime(p.at)} · ${SALE_PAYMENT_METHOD_LABELS[p.method]}`} value={formatNaira(p.amountKobo)} />
            ))}
          </Card>
        </>
      ) : null}
      {s.note ? <Text className="mt-3 text-sm text-ink-600">Note: {s.note}</Text> : null}
      <Text className="mt-3 text-xs text-ink-400">Recorded by {s.recordedBy.fullName.replace('[DEMO] ', '')}</Text>

      {!voided && shop.finance ? (
        <Button
          title="Cancel this sale"
          icon={XCircle}
          variant="ghost"
          className="mt-4 self-start"
          loading={cancel.isPending}
          onPress={async () => {
            const r = await confirm({
              title: 'Cancel this sale?',
              message: 'Use this for a sale entered by mistake. The stock goes back and it leaves your totals. It stays in the book as cancelled.',
              destructive: true,
              confirmLabel: 'Cancel sale',
              cancelLabel: 'Keep',
              reason: { placeholder: 'Why? e.g. entered twice', required: true },
            });
            if (r.confirmed && r.reason) cancel.mutate(r.reason);
          }}
        />
      ) : null}

      <Sheet ref={paySheet} title="Receive payment" snapPoints={['60%']}>
        <Text className="mb-3 text-sm text-ink-600">
          {s.customerName} owes {formatNaira(s.balanceKobo)}.
        </Text>
        <TextField label="Amount received (₦)" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <View className="flex-row flex-wrap">
          {SALE_PAYMENT_METHODS.map((m) => (
            <Chip key={m} label={SALE_PAYMENT_METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        <Button title="Save payment" fullWidth className="mt-2" loading={pay.isPending} disabled={!(nairaInputToKobo(amount) ?? 0)} onPress={() => pay.mutate()} />
      </Sheet>
    </Screen>
  );
}
