import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Receipt } from 'lucide-react-native';
import { EXPENSE_CATEGORY_LABELS, SALE_PAYMENT_METHOD_LABELS, type BooksPeriod, type BooksSummaryDto } from '@kkdm/shared';
import { Button, Card, Chip, ErrorState, KeyValue, LoadingView, Notice, Screen, SectionHeader } from '@/components/ui';
import { BarTrend } from '@/components/charts';
import { Figure, InsightRow } from '@/components/seller';
import { api } from '@/lib/api';
import { formatNaira, formatQuantity } from '@/lib/format';

const PERIODS: { value: BooksPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'year', label: 'This year' },
];

const METHOD_LABELS: Record<string, string> = { ...SALE_PAYMENT_METHOD_LABELS, online: 'Paid online (app)' };

/**
 * The shop's money in plain words: what came in (app orders and shop sales together), what it cost,
 * what was spent, the profit left, and who still owes. Owner and finance staff only.
 */
export default function Money() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const [period, setPeriod] = useState<BooksPeriod>('month');
  const q = useQuery({ queryKey: ['books', shopId, 'summary', period], queryFn: () => api.get<BooksSummaryDto>(`/shops/${shopId}/books/summary`, { period }) });
  const go = (path: string) => () => router.push(`/seller/${shopId}/${path}` as never);

  return (
    <Screen title="Money" subtitle="Profit, sales, expenses and debts" onRefresh={() => void q.refetch()} refreshing={q.isRefetching} padded={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}>
        {PERIODS.map((p) => (
          <Chip key={p.value} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />
        ))}
      </ScrollView>
      <View className="px-4">
        {q.isPending ? <LoadingView /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Body d={q.data} shopId={shopId} go={go} />}
      </View>
    </Screen>
  );
}

function Body({ d, shopId, go }: { d: BooksSummaryDto; shopId: string; go: (p: string) => () => void }) {
  const profitTone = d.netProfitKobo >= 0 ? 'text-white' : 'text-gold-100';
  const trend = d.trend.map((t) => ({ date: t.date, total: t.appKobo + t.inShopKobo }));
  return (
    <>
      {/* Profit, worked out step by step so it is easy to trust */}
      <View className="mt-1 rounded-3xl bg-brand-700 p-4">
        <Text className="text-xs font-semibold uppercase tracking-wide text-brand-100">Profit · {d.period.label}</Text>
        <Text className={`mt-1 text-4xl font-bold ${profitTone}`}>{formatNaira(d.netProfitKobo)}</Text>
        {d.revenue.changePct != null ? (
          <Text className="mt-0.5 text-xs text-brand-100">
            Sales {d.revenue.changePct >= 0 ? 'up' : 'down'} {Math.abs(d.revenue.changePct)}% on the period before
          </Text>
        ) : null}
        <View className="mt-3 rounded-2xl bg-white/10 p-3">
          <Line label="Sales" value={formatNaira(d.revenue.totalKobo)} />
          <Line label="− Cost of what you sold" value={formatNaira(d.costOfGoodsKobo)} />
          <Line label="= Gross profit" value={formatNaira(d.grossProfitKobo)} strong />
          <Line label="− Running costs" value={formatNaira(d.expenses.operatingKobo)} />
          <Line label="= Profit" value={formatNaira(d.netProfitKobo)} strong />
        </View>
      </View>
      {d.costCoverage < 1 ? (
        <Notice tone="warning" title="Profit is an estimate">
          Some items sold have no cost price, so their cost is counted as ₦0. Add cost prices to your products (or when adding stock) for an exact figure.
        </Notice>
      ) : null}

      <View className="mt-3 flex-row">
        <Button title="Sales book" icon={BookOpen} variant="outline" size="sm" className="mr-2 flex-1" onPress={go('sales')} />
        <Button title="Expenses" icon={Receipt} variant="outline" size="sm" className="flex-1" onPress={go('expenses')} />
      </View>

      <SectionHeader title="Sales" />
      <Card>
        <View className="flex-row">
          <View className="flex-1">
            <Figure label="In the shop" value={formatNaira(d.revenue.inShopKobo)} hint={`${d.revenue.inShopCount} sale${d.revenue.inShopCount === 1 ? '' : 's'}`} />
          </View>
          <View className="flex-1">
            <Figure label="Through the app" value={formatNaira(d.revenue.appKobo)} hint={`${d.revenue.appCount} order${d.revenue.appCount === 1 ? '' : 's'} delivered`} />
          </View>
        </View>
        <View className="mt-3">
          <BarTrend data={trend} valueKey="total" label="Sales" />
        </View>
      </Card>

      <SectionHeader title="Money received" />
      <Card>
        {d.collected.byMethod.length ? (
          d.collected.byMethod.map((m) => <KeyValue key={m.method} label={METHOD_LABELS[m.method] ?? m.method} value={formatNaira(m.kobo)} />)
        ) : (
          <Text className="text-sm text-ink-500">No payments in this period.</Text>
        )}
        <KeyValue label="Total received" value={formatNaira(d.collected.totalKobo)} strong />
      </Card>

      <SectionHeader title="Customers owe you" action={d.owed.totalKobo ? 'See who' : undefined} onAction={() => router.push({ pathname: `/seller/${shopId}/sales` as never, params: { owing: '1' } })} />
      <Card>
        <Figure label={`${d.owed.customers} customer${d.owed.customers === 1 ? '' : 's'}`} value={formatNaira(d.owed.totalKobo)} tone={d.owed.totalKobo ? 'bad' : 'default'} hint={d.owed.overdueKobo ? `${formatNaira(d.owed.overdueKobo)} is over 2 weeks old` : 'All time, not just this period'} />
      </Card>

      <SectionHeader title="Expenses" action="Add" onAction={() => router.push({ pathname: `/seller/${shopId}/expenses` as never, params: { add: '1' } })} />
      <Card>
        {d.expenses.byCategory.length ? (
          d.expenses.byCategory.map((e) => <KeyValue key={e.category} label={EXPENSE_CATEGORY_LABELS[e.category]} value={formatNaira(e.kobo)} />)
        ) : (
          <Text className="text-sm text-ink-500">No expenses recorded in this period.</Text>
        )}
        <KeyValue label="Total spent" value={formatNaira(d.expenses.totalKobo)} strong />
        {d.expenses.stockPurchasesKobo ? <Text className="mt-1 text-xs text-ink-500">Buying stock isn’t taken off profit until that stock is sold — then its cost is.</Text> : null}
      </Card>

      {d.topProducts.length ? (
        <>
          <SectionHeader title="Best sellers" />
          <Card>
            {d.topProducts.map((p) => (
              <View key={p.productId ?? p.name} className="flex-row items-center justify-between border-b border-line py-2 last:border-b-0">
                <View className="mr-3 flex-1">
                  <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{p.name}</Text>
                  <Text className="text-xs text-ink-500">{formatQuantity(p.quantity, p.unit)} sold</Text>
                </View>
                <View className="items-end">
                  <Text className="text-sm font-bold text-ink-900">{formatNaira(p.revenueKobo)}</Text>
                  <Text className="text-xs text-ink-500">{p.profitKobo != null ? `profit ${formatNaira(p.profitKobo)}` : 'no cost price'}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Stock on your shelves" />
      <Card onPress={go('inventory')}>
        <View className="flex-row">
          <View className="flex-1">
            <Figure label="Worth at your prices" value={formatNaira(d.stock.retailValueKobo)} />
          </View>
          <View className="flex-1">
            <Figure label="What it cost you" value={formatNaira(d.stock.costValueKobo)} hint={d.stock.productsMissingCost ? `${d.stock.productsMissingCost} product(s) without cost` : undefined} />
          </View>
        </View>
      </Card>

      {d.insights.length ? (
        <>
          <SectionHeader title="Advice" />
          {d.insights.map((i) => (
            <InsightRow key={i.id} insight={i} shopId={shopId} />
          ))}
        </>
      ) : null}
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between py-0.5">
      <Text className={`text-sm ${strong ? 'font-bold text-white' : 'text-brand-100'}`}>{label}</Text>
      <Text className={`text-sm ${strong ? 'font-bold text-white' : 'text-brand-50'}`}>{value}</Text>
    </View>
  );
}
