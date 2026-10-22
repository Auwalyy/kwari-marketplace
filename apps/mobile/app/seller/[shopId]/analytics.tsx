import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, type OrderStatus, type ShopAnalyticsDto } from '@kkdm/shared';
import { Card, ErrorState, KeyValue, LoadingView, Notice, Screen, SectionHeader, SegmentedControl } from '@/components/ui';
import { BarTrend, StatTile } from '@/components/charts';
import { api } from '@/lib/api';
import { formatNaira } from '@/lib/format';

export default function Analytics() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const q = useQuery({ queryKey: ['analytics', shopId, days], queryFn: () => api.get<ShopAnalyticsDto>(`/analytics/shops/${shopId}`, { days }) });
  return (
    <Screen title="Sales analytics" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <SegmentedControl options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} value={days} onChange={setDays} />
      {q.isPending ? <LoadingView /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <View className="flex-row flex-wrap justify-between">
            <StatTile label="Order value" value={formatNaira(q.data.orderValueKobo)} hint="Orders placed (not yet all paid)" />
            <StatTile label="Completed sales" value={formatNaira(q.data.completedSalesKobo)} hint="Delivered or collected" />
            <StatTile label="Gateway-verified payments" value={formatNaira(q.data.gatewayVerifiedKobo)} hint="Confirmed by payment provider" />
            <StatTile label="Seller-confirmed payments" value={formatNaira(q.data.sellerConfirmedKobo)} hint="Cash / transfer you confirmed" />
          </View>
          <Notice tone="info">These figures are calculated from recorded orders and payments. Order value is demand, not money received.</Notice>
          <SectionHeader title="Daily order value" />
          <Card>
            <BarTrend data={q.data.salesTrend} valueKey="orderValueKobo" label="Order value" />
          </Card>
          <SectionHeader title="Orders by status" />
          <Card>
            {Object.entries(q.data.orderCounts).length ? (
              Object.entries(q.data.orderCounts).map(([k, v]) => <KeyValue key={k} label={ORDER_STATUS_LABELS[k as OrderStatus] ?? k} value={String(v)} />)
            ) : (
              <Text className="text-sm text-ink-500">No orders in this period.</Text>
            )}
          </Card>
          <SectionHeader title="Best sellers" />
          <Card>
            {q.data.bestSellers.length ? q.data.bestSellers.map((b) => <KeyValue key={b.productId} label={`${b.name} (${b.quantity})`} value={formatNaira(b.valueKobo)} />) : <Text className="text-sm text-ink-500">No completed sales yet.</Text>}
          </Card>
          <SectionHeader title="Inventory alerts" action={q.data.inventoryAlerts.length ? 'Inventory' : undefined} onAction={() => router.push(`/seller/${shopId}/inventory`)} />
          <Card>
            {q.data.inventoryAlerts.length ? q.data.inventoryAlerts.map((i) => <KeyValue key={i.productId} label={i.name} value={`${i.stockQuantity} · ${i.stockStatus.replace('_', ' ')}`} />) : <Text className="text-sm text-ink-500">All published products are in stock.</Text>}
          </Card>
          <SectionHeader title="Enquiries" />
          <Card>
            <KeyValue label="Pending quotations" value={String(q.data.pendingQuotations)} />
            <KeyValue label="Conversations with unread messages" value={String(q.data.openConversations)} />
          </Card>
          {q.data.workerActivity?.length ? (
            <>
              <SectionHeader title="Worker activity" />
              <Card>{q.data.workerActivity.map((w) => <KeyValue key={w.userId} label={w.fullName} value={`${w.actions} actions`} />)}</Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
