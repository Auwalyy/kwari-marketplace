import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  SALE_PAYMENT_METHODS,
  SALE_PAYMENT_METHOD_LABELS,
  type BooksPeriod,
  type ExpenseCategory,
  type SalePaymentMethod,
  type ShopExpenseDto,
} from '@kkdm/shared';
import { Badge, Button, Chip, PaginatedList, Screen, Sheet, TextField, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatNaira, nairaInputToKobo } from '@/lib/format';

const PERIODS: { value: BooksPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'year', label: 'This year' },
];

/** Money spent running the shop: rent, levies, transport, staff, buying stock… */
export default function Expenses() {
  const { shopId, add } = useLocalSearchParams<{ shopId: string; add?: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const sheet = useRef<SheetHandle>(null);
  const [period, setPeriod] = useState<BooksPeriod>('month');
  const [category, setCategory] = useState<ExpenseCategory>('transport');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SalePaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState<'today' | 'yesterday'>('today');

  // Opening with ?add=1 (the "Expense" button on the shop home) goes straight to the form.
  useEffect(() => {
    if (add) {
      const t = setTimeout(() => sheet.current?.open(), 300);
      return () => clearTimeout(t);
    }
  }, [add]);

  const save = useMutation({
    mutationFn: () =>
      api.post<ShopExpenseDto>(`/shops/${shopId}/books/expenses`, {
        category,
        amountKobo: nairaInputToKobo(amount),
        method,
        note: note.trim() || undefined,
        spentAt: when === 'yesterday' ? new Date(Date.now() - 86_400_000).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Expense saved');
      setAmount('');
      setNote('');
      sheet.current?.close();
      void qc.invalidateQueries({ queryKey: ['books', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/shops/${shopId}/books/expenses/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Expense removed');
      void qc.invalidateQueries({ queryKey: ['books', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });

  return (
    <Screen title="Expenses" scroll={false} padded={false} footer={<Button title="Add expense" icon={Plus} size="lg" fullWidth onPress={() => sheet.current?.open()} />}>
      <View className="pt-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {PERIODS.map((p) => (
            <Chip key={p.value} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />
          ))}
        </ScrollView>
      </View>
      <PaginatedList<ShopExpenseDto>
        key={period}
        queryKey={['books', shopId, 'expenses', period]}
        fetchPage={(page) => api.page<ShopExpenseDto>(`/shops/${shopId}/books/expenses`, { page, period })}
        keyOf={(e) => e.id}
        renderItem={(e) => (
          <Pressable
            onLongPress={async () => {
              if (e.status !== 'active') return;
              const r = await confirm({ title: 'Remove this expense?', message: 'Use this for an expense entered by mistake.', destructive: true, confirmLabel: 'Remove', reason: { placeholder: 'Why?', required: true } });
              if (r.confirmed && r.reason) remove.mutate({ id: e.id, reason: r.reason });
            }}
            className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-3.5"
          >
            <View className="flex-1">
              <Text className={`text-base font-semibold ${e.status === 'voided' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{EXPENSE_CATEGORY_LABELS[e.category]}</Text>
              <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-500">
                {formatDate(e.spentAt)} · {SALE_PAYMENT_METHOD_LABELS[e.method]}
                {e.note ? ` · ${e.note}` : ''}
              </Text>
            </View>
            {e.status === 'voided' ? <Badge label="Removed" tone="neutral" /> : <Text className="text-base font-bold text-ink-900">{formatNaira(e.amountKobo)}</Text>}
          </Pressable>
        )}
        empty={{ title: 'No expenses recorded', message: 'Record money you spend on the shop so your profit is right. Long-press an expense to remove it.' }}
      />

      <Sheet ref={sheet} title="Add expense" snapPoints={['85%']}>
        <Text className="mb-2 text-sm font-medium text-ink-700">What was it for?</Text>
        <View className="flex-row flex-wrap">
          {EXPENSE_CATEGORIES.map((c) => (
            <Chip key={c} label={EXPENSE_CATEGORY_LABELS[c]} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        {category === 'stock_purchase' ? (
          <Text className="mb-3 text-xs text-ink-500">Tip: when you add stock in Inventory you can enter its cost there, which also keeps your profit per product exact.</Text>
        ) : null}
        <TextField label="Amount (₦)" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <View className="flex-row flex-wrap">
          {SALE_PAYMENT_METHODS.map((m) => (
            <Chip key={m} label={SALE_PAYMENT_METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>
        <View className="flex-row">
          <Chip label="Today" selected={when === 'today'} onPress={() => setWhen('today')} />
          <Chip label="Yesterday" selected={when === 'yesterday'} onPress={() => setWhen('yesterday')} />
        </View>
        <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Keke to the bus park" />
        <Button title="Save expense" fullWidth loading={save.isPending} disabled={!(nairaInputToKobo(amount) ?? 0)} onPress={() => save.mutate()} />
      </Sheet>
    </Screen>
  );
}
