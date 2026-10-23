import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus, PencilLine, Search, Trash2 } from 'lucide-react-native';
import {
  SALE_PAYMENT_METHODS,
  SALE_PAYMENT_METHOD_LABELS,
  UNIT_LABELS,
  lineTotalKobo,
  resolveUnitPrice,
  type MeasurementUnit,
  type ProductDto,
  type ProductSummaryDto,
  type SalePaymentMethod,
  type ShopSaleDto,
} from '@kkdm/shared';
import { Button, Card, Chip, Divider, IconButton, Notice, Screen, SectionHeader, Sheet, SwitchRow, TextField, toast, type SheetHandle } from '@/components/ui';
import { useStaffShop } from '@/components/seller';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatNaira, formatQuantity, koboToNairaInput, nairaInputToKobo, unitLabel, uuid } from '@/lib/format';

type StaffProduct = ProductSummaryDto & { stockQuantity: number };

interface Line {
  key: string;
  productId?: string;
  variantId?: string;
  name: string;
  unit: MeasurementUnit;
  qty: string;
  /** Typed price in naira; empty means "use the product's price for this quantity". */
  price: string;
  pricing?: { retailPriceKobo: number; wholesalePriceKobo?: number | null; wholesaleMinQuantity?: number | null; variantPriceKobo?: number | null };
  stock?: number;
  thumb?: string | null;
  unitCostKobo?: number;
}

/** Price per unit for a line: what the seller typed, otherwise the product's retail or wholesale price. */
function unitPrice(l: Line): { kobo: number; wholesale: boolean; auto: boolean } {
  const typed = l.price.trim() ? nairaInputToKobo(l.price) : null;
  if (typed != null) return { kobo: typed, wholesale: false, auto: false };
  if (l.pricing?.variantPriceKobo != null) return { kobo: l.pricing.variantPriceKobo, wholesale: false, auto: true };
  if (l.pricing) {
    const r = resolveUnitPrice(l.pricing, Number(l.qty) || 0);
    return { kobo: r.unitPriceKobo, wholesale: r.wholesale, auto: true };
  }
  return { kobo: 0, wholesale: false, auto: false };
}

/**
 * Record a sale made in the shop: pick what was sold (or type an item that isn't listed), and how the
 * customer paid. Paying less than the total records the rest as owed. Stock is taken automatically.
 */
export default function RecordSale() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const shop = useStaffShop(shopId);
  const picker = useRef<SheetHandle>(null);
  const other = useRef<SheetHandle>(null);
  const [clientRef] = useState(() => uuid());
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('cash');
  const [paidInFull, setPaidInFull] = useState(true);
  const [paid, setPaid] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [when, setWhen] = useState<'now' | 'yesterday'>('now');
  const [note, setNote] = useState('');

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + lineTotalKobo(unitPrice(l).kobo, Number(l.qty) || 0), 0);
  const discountKobo = nairaInputToKobo(discount) ?? 0;
  const total = Math.max(0, subtotal - discountKobo);
  const paidKobo = paidInFull ? total : Math.min(total, nairaInputToKobo(paid) ?? 0);
  const owes = total - paidKobo;
  const problems = [
    !lines.length && 'Add what was sold',
    lines.some((l) => !(Number(l.qty) > 0)) && 'Enter a quantity for each item',
    lines.some((l) => l.stock != null && Number(l.qty) > l.stock) && 'An item has more than the stock you recorded',
    discountKobo > subtotal && 'The discount is more than the total',
    owes > 0 && !customerName.trim() && 'Add the customer’s name so you can track what they owe',
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: () =>
      api.post<ShopSaleDto>(`/shops/${shopId}/books/sales`, {
        clientRef,
        items: lines.map((l) => {
          const p = unitPrice(l);
          return l.productId
            ? { productId: l.productId, variantId: l.variantId, quantity: Number(l.qty), ...(p.auto ? {} : { unitPriceKobo: p.kobo }) }
            : { name: l.name, unit: l.unit, quantity: Number(l.qty), unitPriceKobo: p.kobo, unitCostKobo: l.unitCostKobo };
        }),
        discountKobo,
        amountPaidKobo: paidKobo,
        paymentMethod: method,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        soldAt: when === 'yesterday' ? new Date(Date.now() - 86_400_000).toISOString() : undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: (sale) => {
      void qc.invalidateQueries({ queryKey: ['books', shopId] });
      void qc.invalidateQueries({ queryKey: ['inventory', shopId] });
      void qc.invalidateQueries({ queryKey: ['seller-products', shopId] });
      toast.success(sale.balanceKobo > 0 ? `Sale recorded — ${sale.customerName} owes ${formatNaira(sale.balanceKobo)}` : 'Sale recorded');
      router.replace({ pathname: `/seller/${shopId}/sales/${sale.id}` as never, params: { fresh: '1' } });
    },
    onError: (e) => toast.apiError(e),
  });

  const addProduct = (p: ProductDto, variantId?: string) => {
    const v = variantId ? p.variants.find((x) => x.id === variantId) : undefined;
    setLines((ls) => [
      ...ls,
      {
        key: uuid(),
        productId: p.id,
        variantId,
        name: v ? `${p.name} — ${v.label}` : p.name,
        unit: p.unit,
        qty: '1',
        price: '',
        pricing: { retailPriceKobo: p.retailPriceKobo, wholesalePriceKobo: p.wholesalePriceKobo, wholesaleMinQuantity: p.wholesaleMinQuantity, variantPriceKobo: v?.priceOverrideKobo ?? null },
        stock: p.trackInventory ? (v ? v.stockQuantity : p.stockQuantity) : undefined,
        thumb: p.thumbnailUrl,
      },
    ]);
    picker.current?.close();
  };

  return (
    <Screen
      title="Record a sale"
      footer={
        <View>
          <View className="mb-2 flex-row items-end justify-between">
            <Text className="text-sm text-ink-500">{owes > 0 ? `Paid ${formatNaira(paidKobo)} · owes ${formatNaira(owes)}` : 'Total'}</Text>
            <Text className="text-2xl font-bold text-ink-900">{formatNaira(total)}</Text>
          </View>
          <Button title="Save sale" size="lg" fullWidth loading={save.isPending} disabled={problems.length > 0} onPress={() => save.mutate()} />
          {problems.length && lines.length ? <Text className="mt-1.5 text-center text-xs text-danger-500">{problems[0]}</Text> : null}
        </View>
      }
    >
      <SectionHeader title="What was sold" />
      {lines.map((l) => {
        const p = unitPrice(l);
        const q = Number(l.qty) || 0;
        return (
          <Card key={l.key} className="mb-2 p-3">
            <View className="flex-row items-center">
              {l.thumb ? <Image source={{ uri: l.thumb }} style={{ width: 40, height: 40, borderRadius: 8 }} /> : null}
              <View className="ml-2 flex-1">
                <Text numberOfLines={2} className="text-sm font-semibold text-ink-900">{l.name}</Text>
                {l.stock != null ? <Text className={`text-xs ${q > l.stock ? 'text-danger-500' : 'text-ink-500'}`}>{formatQuantity(l.stock, l.unit)} in stock</Text> : null}
              </View>
              <IconButton icon={Trash2} label="Remove item" onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
            </View>
            <View className="mt-2 flex-row">
              <TextField containerClassName="mb-0 mr-2 flex-1" label={`Quantity (${unitLabel(l.unit, 2)})`} keyboardType="decimal-pad" value={l.qty} onChangeText={(t) => update(l.key, { qty: t })} />
              <TextField
                containerClassName="mb-0 flex-1"
                label={`Price per ${unitLabel(l.unit)} (₦)`}
                keyboardType="numeric"
                value={l.price}
                placeholder={koboToNairaInput(p.auto ? p.kobo : null) || '0'}
                onChangeText={(t) => update(l.key, { price: t })}
              />
            </View>
            <View className="mt-1.5 flex-row justify-between">
              <Text className="text-xs text-ink-500">{p.auto ? (p.wholesale ? 'Wholesale price' : 'Shop price') : 'Your price'}</Text>
              <Text className="text-sm font-bold text-ink-900">{formatNaira(lineTotalKobo(p.kobo, q))}</Text>
            </View>
          </Card>
        );
      })}
      <View className="flex-row">
        <Button title="Add from my products" icon={PackagePlus} variant={lines.length ? 'outline' : 'primary'} className="mr-2 flex-1" onPress={() => picker.current?.open()} />
        <Button title="Other item" icon={PencilLine} variant="outline" onPress={() => other.current?.open()} />
      </View>

      <SectionHeader title="Payment" />
      <View className="flex-row flex-wrap">
        {SALE_PAYMENT_METHODS.map((m) => (
          <Chip key={m} label={SALE_PAYMENT_METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </View>
      <SwitchRow label="Customer paid in full" description={paidInFull ? undefined : 'The rest is recorded as owed'} value={paidInFull} onChange={setPaidInFull} />
      {!paidInFull ? <TextField label="Amount paid now (₦)" keyboardType="numeric" value={paid} onChangeText={setPaid} placeholder="0" hint={owes > 0 ? `Customer will owe ${formatNaira(owes)}` : undefined} /> : null}
      <TextField label="Discount (₦, optional)" keyboardType="numeric" value={discount} onChangeText={setDiscount} placeholder="0" />

      <SectionHeader title={owes > 0 ? 'Customer (needed for credit)' : 'Customer (optional)'} />
      <TextField label="Name" value={customerName} onChangeText={setCustomerName} placeholder="e.g. Malam Bello" />
      <TextField label="Phone" value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" placeholder="080…" />

      <SectionHeader title="When" />
      <View className="flex-row">
        <Chip label="Today" selected={when === 'now'} onPress={() => setWhen('now')} />
        <Chip label="Yesterday" selected={when === 'yesterday'} onPress={() => setWhen('yesterday')} />
      </View>
      <TextField label="Note (optional)" value={note} onChangeText={setNote} />
      <Notice tone="info">Stock is taken from Inventory when you save. Your sales book, profit and debts update straight away.</Notice>

      <Sheet ref={picker} title="Add from my products" snapPoints={['85%']}>
        <ProductPicker shopId={shopId} onPick={addProduct} />
      </Sheet>
      <Sheet ref={other} title="Item not in my products" snapPoints={['80%']}>
        <OtherItem
          finance={shop.finance}
          onAdd={(l) => {
            setLines((ls) => [...ls, l]);
            other.current?.close();
          }}
        />
      </Sheet>
    </Screen>
  );
}

function ProductPicker({ shopId, onPick }: { shopId: string; onPick: (p: ProductDto, variantId?: string) => void }) {
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [withVariants, setWithVariants] = useState<ProductDto | null>(null);
  const list = useQuery({ queryKey: ['seller-products', shopId, 'pick', q], queryFn: () => api.page<StaffProduct>(`/shops/${shopId}/products`, { q: q || undefined, limit: 30 }) });

  const choose = async (id: string) => {
    setOpening(id);
    try {
      const p = await api.get<ProductDto>(`/shops/${shopId}/products/${id}`);
      const active = p.variants.filter((v) => v.active);
      if (active.length) setWithVariants(p);
      else onPick(p);
    } catch (e) {
      toast.apiError(e);
    } finally {
      setOpening(null);
    }
  };

  if (withVariants) {
    return (
      <View>
        <Text className="mb-2 text-base font-semibold text-ink-900">{withVariants.name}</Text>
        <Text className="mb-3 text-sm text-ink-500">Which one was sold?</Text>
        <View className="flex-row flex-wrap">
          {withVariants.variants
            .filter((v) => v.active)
            .map((v) => (
              <Chip key={v.id} label={`${v.label} (${v.stockQuantity})`} onPress={() => onPick(withVariants, v.id)} />
            ))}
        </View>
        <Button title="Back to products" variant="ghost" onPress={() => setWithVariants(null)} />
      </View>
    );
  }
  return (
    <View>
      <TextField icon={Search} placeholder="Search my products" value={q} onChangeText={setQ} autoCorrect={false} />
      {list.isPending ? <ActivityIndicator color={colors.brand} /> : null}
      {list.data?.items.map((p) => (
        <Pressable key={p.id} onPress={() => void choose(p.id)} disabled={!!opening} className="flex-row items-center border-b border-line py-2.5 active:bg-cream-50">
          <View className="h-11 w-11 overflow-hidden rounded-lg bg-cream-200">{p.thumbnailUrl ? <Image source={{ uri: p.thumbnailUrl }} style={{ width: 44, height: 44 }} /> : null}</View>
          <View className="ml-3 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{p.name}</Text>
            <Text className={`text-xs ${p.stockQuantity <= 0 ? 'text-danger-500' : 'text-ink-500'}`}>
              {formatQuantity(p.stockQuantity, p.unit)} in stock · {formatNaira(p.retailPriceKobo)} / {unitLabel(p.unit)}
            </Text>
          </View>
          {opening === p.id ? <ActivityIndicator color={colors.brand} /> : null}
        </Pressable>
      ))}
      {list.data && !list.data.items.length ? <Text className="py-6 text-center text-sm text-ink-500">No products found. Use “Other item” for things you haven’t listed.</Text> : null}
    </View>
  );
}

function OtherItem({ finance, onAdd }: { finance: boolean; onAdd: (l: Line) => void }) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<MeasurementUnit>('piece');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const ok = name.trim().length > 1 && Number(qty) > 0 && nairaInputToKobo(price) != null;
  return (
    <View>
      <TextField label="What was sold" value={name} onChangeText={setName} placeholder="e.g. Lace offcut, thread, cap" />
      <View className="flex-row flex-wrap">
        {(['piece', 'yard', 'metre', 'roll', 'bundle', 'set', 'pack'] as MeasurementUnit[]).map((u) => (
          <Chip key={u} label={UNIT_LABELS[u].singular} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </View>
      <View className="flex-row">
        <TextField containerClassName="mr-2 flex-1" label="Quantity" keyboardType="decimal-pad" value={qty} onChangeText={setQty} />
        <TextField containerClassName="flex-1" label={`Price per ${UNIT_LABELS[unit].singular} (₦)`} keyboardType="numeric" value={price} onChangeText={setPrice} />
      </View>
      {finance ? <TextField label={`What one ${UNIT_LABELS[unit].singular} cost you (₦, optional)`} keyboardType="numeric" value={cost} onChangeText={setCost} hint="For an exact profit figure" /> : null}
      <Divider />
      <Button
        title="Add to sale"
        fullWidth
        disabled={!ok}
        onPress={() => onAdd({ key: uuid(), name: name.trim(), unit, qty, price, unitCostKobo: nairaInputToKobo(cost) ?? undefined })}
      />
    </View>
  );
}
