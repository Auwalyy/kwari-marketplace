import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { SALE_PAYMENT_METHODS, SALE_PAYMENT_METHOD_LABELS, lineTotalKobo, type BooksPeriod, type ResellerListingDto, type ResellerSaleDto, type SalePaymentMethod } from '@kkdm/shared';
import { Badge, Button, Chip, PaginatedList, Screen, Sheet, SwitchRow, TextField, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatNaira, formatQuantity, koboToNairaInput, nairaInputToKobo, unitLabel, uuid } from '@/lib/format';

type Filter = BooksPeriod | 'all' | 'owing';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All' },
  { value: 'owing', label: 'Owing' },
];

/** The reseller's own sales book: what they sold to their customers, their profit, and who still owes. */
export default function ResellerSales() {
  const params = useLocalSearchParams<{ owing?: string; add?: string; requestId?: string; listingId?: string; quantity?: string; customerName?: string; customerPhone?: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const addSheet = useRef<SheetHandle>(null);
  const saleSheet = useRef<SheetHandle>(null);
  const [filter, setFilter] = useState<Filter>(params.owing ? 'owing' : 'month');
  const listings = useQuery({ queryKey: ['reseller', 'listings'], queryFn: () => api.page<ResellerListingDto>('/resellers/me/listings', { limit: 50 }) });

  // New sale form
  const [clientRef, setClientRef] = useState(() => uuid());
  const [listingId, setListingId] = useState<string | undefined>(params.listingId);
  const [qty, setQty] = useState(params.quantity ?? '1');
  const [price, setPrice] = useState('');
  const [paidInFull, setPaidInFull] = useState(true);
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('cash');
  const [customerName, setCustomerName] = useState(params.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(params.customerPhone ?? '');
  const listing = listings.data?.items.find((l) => l.id === listingId);
  const unitPrice = nairaInputToKobo(price) ?? listing?.priceKobo ?? 0;
  const total = lineTotalKobo(unitPrice, Number(qty) || 0);
  const paidKobo = paidInFull ? total : Math.min(total, nairaInputToKobo(paid) ?? 0);
  const cost = listing?.source?.resellerPriceKobo;
  const profit = cost != null ? total - lineTotalKobo(cost, Number(qty) || 0) : null;

  useEffect(() => {
    if (params.add) {
      const t = setTimeout(() => addSheet.current?.open(), 300);
      return () => clearTimeout(t);
    }
  }, [params.add]);

  const record = useMutation({
    mutationFn: () =>
      api.post<ResellerSaleDto>('/resellers/me/sales', {
        clientRef,
        listingId,
        quantity: Number(qty),
        ...(price ? { unitPriceKobo: nairaInputToKobo(price) } : {}),
        amountPaidKobo: paidKobo,
        paymentMethod: method,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        requestId: params.requestId,
      }),
    onSuccess: (s) => {
      toast.success(s.balanceKobo > 0 ? `Sale saved — ${s.customerName} owes ${formatNaira(s.balanceKobo)}` : `Sale saved${s.profitKobo != null ? ` — you made ${formatNaira(s.profitKobo)}` : ''}`);
      addSheet.current?.close();
      setClientRef(uuid());
      setQty('1');
      setPrice('');
      setPaid('');
      setPaidInFull(true);
      setCustomerName('');
      setCustomerPhone('');
      void qc.invalidateQueries({ queryKey: ['reseller'] });
    },
    onError: (e) => toast.apiError(e),
  });

  // Existing sale: receive payment / cancel
  const [current, setCurrent] = useState<ResellerSaleDto | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const pay = useMutation({
    mutationFn: () => api.post<ResellerSaleDto>(`/resellers/me/sales/${current!.id}/payments`, { amountKobo: nairaInputToKobo(payAmount), method }),
    onSuccess: (s) => {
      setCurrent(s);
      void qc.invalidateQueries({ queryKey: ['reseller'] });
      toast.success(s.balanceKobo > 0 ? `Saved — still owes ${formatNaira(s.balanceKobo)}` : 'Fully paid');
    },
    onError: (e) => toast.apiError(e),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => api.post<ResellerSaleDto>(`/resellers/me/sales/${current!.id}/void`, { reason }),
    onSuccess: () => {
      saleSheet.current?.close();
      void qc.invalidateQueries({ queryKey: ['reseller'] });
      toast.success('Sale cancelled');
    },
    onError: (e) => toast.apiError(e),
  });

  const problem = !listingId ? 'Choose what you sold' : !(Number(qty) > 0) ? 'Enter the quantity' : paidKobo < total && !customerName.trim() ? 'Add the customer’s name so you can track what they owe' : null;

  return (
    <Screen title="My sales" scroll={false} padded={false} footer={<Button title="Record a sale" icon={Plus} size="lg" fullWidth onPress={() => addSheet.current?.open()} />}>
      <View className="pt-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ScrollView>
      </View>
      <PaginatedList<ResellerSaleDto>
        key={filter}
        queryKey={['reseller', 'sales', filter]}
        fetchPage={(page) => api.page<ResellerSaleDto>('/resellers/me/sales', { page, period: filter === 'all' || filter === 'owing' ? undefined : filter, owing: filter === 'owing' ? 'true' : undefined })}
        keyOf={(s) => s.id}
        renderItem={(s) => (
          <Pressable
            onPress={() => {
              setCurrent(s);
              setPayAmount(koboToNairaInput(s.balanceKobo));
              saleSheet.current?.open();
            }}
            className="mb-2 rounded-2xl border border-line bg-white p-3.5 active:bg-cream-50"
          >
            <View className="flex-row items-start justify-between">
              <View className="mr-3 flex-1">
                <Text numberOfLines={1} className="text-base font-semibold text-ink-900">{s.customerName ?? 'Customer'}</Text>
                <Text numberOfLines={1} className="text-sm text-ink-600">{formatQuantity(s.quantity, s.unit)} {s.name}</Text>
              </View>
              <View className="items-end">
                <Text className={`text-base font-bold ${s.status === 'voided' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{formatNaira(s.totalKobo)}</Text>
                {s.status === 'voided' ? <Badge label="Cancelled" tone="neutral" /> : s.balanceKobo > 0 ? <Badge label={`Owes ${formatNaira(s.balanceKobo)}`} tone="warning" /> : <Badge label="Paid" tone="success" />}
              </View>
            </View>
            <Text className="mt-1 text-xs text-ink-500">
              {formatDateTime(s.soldAt)}
              {s.profitKobo != null && s.status !== 'voided' ? ` · profit ${formatNaira(s.profitKobo)}` : ''}
            </Text>
          </Pressable>
        )}
        empty={filter === 'owing' ? { title: 'Nobody owes you', message: 'Sales where your customer pays later show here.' } : { title: 'No sales yet', message: 'Record each sale to your customers to see your profit and who owes you.' }}
      />

      <Sheet ref={addSheet} title="Record a sale" snapPoints={['92%']}>
        <Text className="mb-2 text-sm font-medium text-ink-700">What did you sell?</Text>
        <View className="flex-row flex-wrap">
          {(listings.data?.items ?? []).map((l) => (
            <Chip key={l.id} label={l.product.name.length > 34 ? `${l.product.name.slice(0, 32)}…` : l.product.name} selected={listingId === l.id} onPress={() => setListingId(l.id)} />
          ))}
        </View>
        {!listings.data?.items.length ? <Text className="mb-3 text-sm text-ink-500">Add products to your list first.</Text> : null}
        {listing ? (
          <>
            <View className="flex-row">
              <TextField containerClassName="mr-2 flex-1" label={`Quantity (${unitLabel(listing.product.unit, 2)})`} keyboardType="decimal-pad" value={qty} onChangeText={setQty} />
              <TextField containerClassName="flex-1" label={`Price per ${unitLabel(listing.product.unit)} (₦)`} keyboardType="numeric" value={price} placeholder={koboToNairaInput(listing.priceKobo)} onChangeText={setPrice} />
            </View>
            <View className="mb-3 rounded-xl bg-brand-50 p-3">
              <Text className="text-base font-bold text-ink-900">Total {formatNaira(total)}</Text>
              {profit != null ? <Text className={`text-sm ${profit >= 0 ? 'text-brand-700' : 'text-danger-500'}`}>Your profit {formatNaira(profit)}</Text> : null}
            </View>
          </>
        ) : null}
        <View className="flex-row flex-wrap">
          {SALE_PAYMENT_METHODS.map((m) => (
            <Chip key={m} label={SALE_PAYMENT_METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        <SwitchRow label="Customer paid in full" value={paidInFull} onChange={setPaidInFull} />
        {!paidInFull ? <TextField label="Amount paid now (₦)" keyboardType="numeric" value={paid} onChangeText={setPaid} hint={`Customer will owe ${formatNaira(total - paidKobo)}`} /> : null}
        <TextField label={paidInFull ? 'Customer name (optional)' : 'Customer name'} value={customerName} onChangeText={setCustomerName} />
        <TextField label="Customer phone (optional)" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
        <Button title="Save sale" fullWidth loading={record.isPending} disabled={!!problem} onPress={() => record.mutate()} />
        {problem && listingId ? <Text className="mt-1.5 text-center text-xs text-danger-500">{problem}</Text> : null}
      </Sheet>

      <Sheet ref={saleSheet} title={current ? `Sale ${current.number}` : ''} snapPoints={['70%']}>
        {current ? (
          <View>
            <Text className="text-base font-semibold text-ink-900">{current.customerName ?? 'Customer'}</Text>
            <Text className="text-sm text-ink-600">
              {formatQuantity(current.quantity, current.unit)} {current.name} × {formatNaira(current.unitPriceKobo)}
            </Text>
            <Text className="mt-2 text-sm text-ink-800">
              Total {formatNaira(current.totalKobo)} · paid {formatNaira(current.amountPaidKobo)}
              {current.profitKobo != null ? ` · profit ${formatNaira(current.profitKobo)}` : ''}
            </Text>
            {current.status === 'completed' && current.balanceKobo > 0 ? (
              <>
                <Text className="mt-3 text-sm font-semibold text-warning-500">Still owes {formatNaira(current.balanceKobo)}</Text>
                <TextField label="Amount received (₦)" keyboardType="numeric" value={payAmount} onChangeText={setPayAmount} containerClassName="mt-2" />
                <Button title="Save payment" fullWidth loading={pay.isPending} disabled={!(nairaInputToKobo(payAmount) ?? 0)} onPress={() => pay.mutate()} />
              </>
            ) : null}
            {current.status === 'completed' ? (
              <Button
                title="Cancel this sale"
                variant="ghost"
                className="mt-3"
                onPress={async () => {
                  const r = await confirm({ title: 'Cancel this sale?', destructive: true, confirmLabel: 'Cancel sale', cancelLabel: 'Keep', reason: { placeholder: 'Why?', required: true } });
                  if (r.confirmed && r.reason) cancel.mutate(r.reason);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
