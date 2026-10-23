import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookOpen,
  Boxes,
  ClipboardList,
  Eye,
  FileText,
  MessageCircle,
  Package,
  PackagePlus,
  Plus,
  Receipt,
  Settings,
  ShoppingBag,
  Star,
  Wallet,
} from 'lucide-react-native';
import type { ShopDashboardDto } from '@kkdm/shared';
import { Badge, Button, ErrorState, IconButton, LoadingView, PendingBanner, RiskBanner, VerificationBadge } from '@/components/ui';
import { Figure, InsightRow, QuickAction, ShopTile, useStaffShop } from '@/components/seller';
import { colors } from '@/constants/theme';
import { useUnreadCounts } from '@/hooks';
import { api } from '@/lib/api';
import { formatNaira } from '@/lib/format';

/**
 * The seller's home: today's money, big buttons for everyday jobs, what needs attention, and every part
 * of the shop one tap away. Owner-only settings sit behind the gear icon. Each person only sees what
 * their role allows; the server enforces the same rules.
 */
export function ShopHome({ shopId, topInset = 0, switcher }: { shopId: string; topInset?: number; switcher?: ReactNode }) {
  const shop = useStaffShop(shopId);
  const unread = useUnreadCounts();
  const dash = useQuery({ queryKey: ['books', shopId, 'dashboard'], queryFn: () => api.get<ShopDashboardDto>(`/shops/${shopId}/books/dashboard`), enabled: !!shop.data?.viewerRole });
  const go = (path: string) => () => router.push(`/seller/${shopId}/${path}` as never);

  if (shop.isPending) return <View className="flex-1 bg-cream-100" style={{ paddingTop: topInset }}><LoadingView /></View>;
  if (shop.isError) return <View className="flex-1 bg-cream-100" style={{ paddingTop: topInset }}><ErrorState error={shop.error} onRetry={() => shop.refetch()} /></View>;
  const s = shop.data;
  const { can, finance } = shop;
  const d = dash.data;
  const sells = can('sales.record');
  const pending = s.status === 'pending_membership' || s.status === 'rejected';

  return (
    <ScrollView
      className="flex-1 bg-cream-100"
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={shop.isRefetching || dash.isRefetching}
          onRefresh={() => {
            void shop.refetch();
            void dash.refetch();
          }}
          tintColor={colors.white}
          colors={[colors.brand]}
        />
      }
    >
      {/* Header: who / which shop, today's money and the everyday buttons */}
      <View className="rounded-b-3xl bg-brand-700 px-4 pb-4" style={{ paddingTop: topInset + 8 }}>
        {switcher}
        <View className="flex-row items-start">
          <View className="flex-1">
            <Text numberOfLines={1} className="text-2xl font-bold text-white">{s.name}</Text>
            <Text className="mt-0.5 text-sm text-brand-100">
              Shop {s.shopNumber} · {s.viewerRole === 'owner' ? 'Owner' : 'Staff'}
            </Text>
          </View>
          <IconButton icon={Eye} label="See my shop as customers do" color={colors.white} onPress={() => router.push(`/shop/${s.slug}`)} />
          {can('owner') ? <IconButton icon={Settings} label="Shop settings" color={colors.white} onPress={go('settings')} /> : null}
        </View>
        <View className="mt-2 flex-row flex-wrap items-center">
          <VerificationBadge status={s.verificationStatus} />
          {s.status !== 'active' ? <Badge label={s.status.replace('_', ' ')} tone="warning" className="ml-2" /> : null}
        </View>

        {d && (sells || finance || can('reports.view')) ? (
          <View className="mt-4 rounded-2xl bg-white/10 p-3.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-brand-100">Today</Text>
            <View className="mt-1 flex-row">
              <View className="flex-1">
                <Figure label="Sales" value={formatNaira(d.today.salesKobo)} hint={`${d.today.salesCount} sale${d.today.salesCount === 1 ? '' : 's'}`} tone="light" big />
              </View>
              <View className="items-end">
                <Figure label="Money received" value={formatNaira(d.today.collectedKobo)} tone="light" />
                {d.today.profitKobo != null ? <Figure label="Profit" value={formatNaira(d.today.profitKobo)} tone="light" /> : null}
              </View>
            </View>
            {d.owedKobo ? (
              <Text onPress={() => router.push({ pathname: `/seller/${shopId}/sales` as never, params: { owing: '1' } })} className="mt-1 text-xs font-semibold text-gold-100">
                Customers owe you {formatNaira(d.owedKobo)} · see who →
              </Text>
            ) : null}
          </View>
        ) : null}

        <View className="-mx-1 mt-4 flex-row">
          {sells ? <QuickAction icon={Plus} label="Record a sale" primary onPress={go('sales/new')} /> : null}
          {can('inventory.manage') ? <QuickAction icon={PackagePlus} label="Add stock" onPress={go('inventory')} /> : null}
          {can('products.manage') ? <QuickAction icon={Package} label="New product" onPress={go('product/new')} /> : null}
          {finance ? <QuickAction icon={Receipt} label="Expense" onPress={() => router.push({ pathname: `/seller/${shopId}/expenses` as never, params: { add: '1' } })} /> : null}
        </View>
      </View>

      <View className="px-4">
        {s.status === 'pending_membership' ? (
          <View className="mt-4">
            <PendingBanner text="Your shop is waiting for the house head to approve it. Customers can't see it yet, but you can set it up now." />
            <Button title="See approval status" variant="outline" size="sm" className="self-start" onPress={go('membership')} />
          </View>
        ) : null}
        {s.status === 'rejected' ? <View className="mt-4"><RiskBanner text="The house did not approve this shop. Open House membership for details." /></View> : null}
        {s.status === 'suspended' ? <View className="mt-4"><RiskBanner text="This shop is suspended by an administrator. Customers can't see it, but your records still work." /></View> : null}

        {d?.insights.length ? (
          <>
            <Text className="mb-2 mt-5 text-lg font-bold text-ink-900">Needs your attention</Text>
            {d.insights.slice(0, 6).map((i) => (
              <InsightRow key={i.id} insight={i} shopId={shopId} />
            ))}
          </>
        ) : d && !pending ? (
          <View className="mt-5 rounded-2xl border border-line bg-white p-4">
            <Text className="text-sm font-semibold text-ink-900">All caught up</Text>
            <Text className="mt-0.5 text-sm text-ink-500">No orders waiting, no low stock and no unanswered chats.</Text>
          </View>
        ) : null}

        <Text className="mb-2 mt-5 text-lg font-bold text-ink-900">Run your shop</Text>
        <View className="flex-row flex-wrap justify-between">
          {can('orders.manage') ? <ShopTile icon={ClipboardList} label="Orders" detail={d?.pendingOrders ? `${d.pendingOrders} waiting` : 'App orders'} badge={d?.pendingOrders} onPress={go('orders')} /> : null}
          {can('chats.manage') ? <ShopTile icon={MessageCircle} label="Chats" detail="Customer messages" badge={unread.shopChats[shopId] ?? d?.unreadEnquiries} onPress={go('enquiries')} /> : null}
          {sells || finance ? <ShopTile icon={BookOpen} label="Sales book" detail="Shop sales & debts" onPress={go('sales')} /> : null}
          {finance ? <ShopTile icon={Wallet} label="Money" detail="Profit, expenses, reports" onPress={go('books')} /> : null}
          {can('inventory.manage') ? <ShopTile icon={Boxes} label="Inventory" detail={d && (d.lowStockCount || d.outOfStockCount) ? `${d.outOfStockCount} out · ${d.lowStockCount} low` : 'Stock levels'} badge={d?.outOfStockCount} onPress={go('inventory')} /> : null}
          {can('products.manage') ? <ShopTile icon={ShoppingBag} label="Products" detail={`${s.activeProductCount} on sale`} onPress={go('products')} /> : null}
          {can('quotations.manage') ? <ShopTile icon={FileText} label="Quotations" detail={d?.pendingQuotations ? `${d.pendingQuotations} to answer` : 'Wholesale prices'} badge={d?.pendingQuotations} onPress={() => router.push({ pathname: '/quotations', params: { shopId } })} /> : null}
          {can('reports.view') && !finance ? <ShopTile icon={BarChart3} label="Sales report" detail="App orders" onPress={go('analytics')} /> : null}
          <ShopTile icon={Star} label="Reviews" detail={`${s.ratingCount} review${s.ratingCount === 1 ? '' : 's'}`} onPress={go('reviews')} />
        </View>

        {can('owner') ? <Button title="Shop settings" icon={Settings} variant="outline" fullWidth className="mt-2" onPress={go('settings')} /> : null}
      </View>
    </ScrollView>
  );
}
