import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  BarChart3,
  Boxes,
  ClipboardList,
  Eye,
  FileText,
  History,
  Megaphone,
  MessageCircle,
  Package,
  Settings,
  Star,
  Truck,
  Users,
} from 'lucide-react-native';
import type { ShopAnalyticsDto, ShopDto, ShopPermission } from '@kkdm/shared';
import { Badge, ErrorState, ListItem, LoadingView, PendingBanner, RiskBanner, Screen, SectionHeader, VerificationBadge } from '@/components/ui';
import { StatTile } from '@/components/charts';
import { useUnreadCounts } from '@/hooks';
import { api } from '@/lib/api';
import { formatNaira } from '@/lib/format';

type StaffShop = ShopDto & { viewerRole: 'owner' | 'worker'; viewerPermissions: ShopPermission[] };

/** Shop dashboard. Menu items are filtered by the role the server reports; the API enforces it again. */
export default function ShopDashboard() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const unread = useUnreadCounts();
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<StaffShop>(`/shops/${shopId}`) });
  const can = (p: ShopPermission | 'owner') => !!shop.data && (shop.data.viewerRole === 'owner' || (p !== 'owner' && shop.data.viewerPermissions?.includes(p)));
  const analytics = useQuery({ queryKey: ['analytics', shopId, 30], queryFn: () => api.get<ShopAnalyticsDto>(`/analytics/shops/${shopId}`, { days: 30 }), enabled: !!shop.data && can('reports.view') });

  if (shop.isPending) return <Screen title="Shop"><LoadingView /></Screen>;
  if (shop.isError) return <Screen title="Shop"><ErrorState error={shop.error} onRetry={() => shop.refetch()} /></Screen>;
  const s = shop.data;
  if (!s.viewerRole) return <Screen title={s.name}><ErrorState error={new Error('You are not a member of this shop')} /></Screen>;
  const a = analytics.data;
  const pendingOrders = a?.orderCounts.pending_acceptance ?? 0;
  const go = (path: string) => () => router.push(`/seller/${shopId}/${path}` as never);

  return (
    <Screen title={s.name} subtitle={`${s.viewerRole === 'owner' ? 'Owner' : 'Worker'} · Shop ${s.shopNumber}`} onRefresh={() => { void shop.refetch(); void analytics.refetch(); }} refreshing={shop.isRefetching} padded={false}>
      <View className="px-4">
        {s.status === 'pending_membership' ? <PendingBanner text="Your shop is waiting for house approval and is not yet visible to customers." /> : null}
        {s.status === 'suspended' ? <RiskBanner text="This shop is suspended by an administrator. Customers can’t see it." /> : null}
        <View className="mb-2 flex-row flex-wrap items-center">
          <VerificationBadge status={s.verificationStatus} />
          <Badge label={s.status.replace('_', ' ')} tone={s.status === 'active' ? 'success' : 'warning'} className="ml-2" />
        </View>
        {a ? (
          <>
            <SectionHeader title="Last 30 days" action="Analytics" onAction={go('analytics')} />
            <View className="flex-row flex-wrap justify-between">
              <StatTile label="Awaiting acceptance" value={String(pendingOrders)} hint="orders" />
              <StatTile label="Order value" value={formatNaira(a.orderValueKobo)} hint="all active & completed orders" />
              <StatTile label="Completed sales" value={formatNaira(a.completedSalesKobo)} hint="delivered / collected" />
              <StatTile label="Verified online payments" value={formatNaira(a.gatewayVerifiedKobo)} hint={`+ ${formatNaira(a.sellerConfirmedKobo)} confirmed by you`} />
            </View>
            {a.inventoryAlerts.length ? <Text className="mt-1 text-sm text-warning-500">{a.inventoryAlerts.length} product(s) low or out of stock</Text> : null}
          </>
        ) : null}
      </View>

      <View className="px-4"><SectionHeader title="Manage" /></View>
      <View className="border-y border-line">
        {can('orders.manage') ? <ListItem icon={ClipboardList} title="Orders" subtitle={pendingOrders ? `${pendingOrders} awaiting acceptance` : 'Accept, process and complete orders'} onPress={go('orders')} /> : null}
        {can('chats.manage') ? <ListItem icon={MessageCircle} title="Customer enquiries" subtitle={unread.shopChats[shopId] ? `${unread.shopChats[shopId]} unread` : 'Chats with customers'} onPress={go('enquiries')} /> : null}
        {can('quotations.manage') ? <ListItem icon={FileText} title="Quotation requests" subtitle={a?.pendingQuotations ? `${a.pendingQuotations} awaiting reply` : 'Wholesale price requests'} onPress={() => router.push({ pathname: '/quotations', params: { shopId } })} /> : null}
        {can('products.manage') ? <ListItem icon={Package} title="Products" subtitle={`${s.activeProductCount} published`} onPress={go('products')} /> : null}
        {can('inventory.manage') ? <ListItem icon={Boxes} title="Inventory" subtitle="Stock levels and adjustments" onPress={go('inventory')} /> : null}
        {can('reports.view') ? <ListItem icon={BarChart3} title="Sales analytics" onPress={go('analytics')} /> : null}
        <ListItem icon={Star} title="Reviews" subtitle={`${s.ratingCount} reviews`} onPress={go('reviews')} />
        <ListItem icon={Eye} title="View public storefront" onPress={() => router.push(`/shop/${s.slug}`)} />
      </View>

      {can('owner') ? (
        <>
          <View className="px-4"><SectionHeader title="Owner settings" /></View>
          <View className="border-y border-line">
            <ListItem icon={Settings} title="Shop profile" subtitle="Name, logo, description, hours, contact" onPress={go('profile')} />
            <ListItem icon={Truck} title="Pickup, delivery & payment" onPress={go('fulfilment')} />
            <ListItem icon={Users} title="Workers & permissions" onPress={go('workers')} />
            <ListItem icon={BadgeCheck} title="Verification & ownership" subtitle={s.verificationStatus === 'verified' ? 'Verified' : 'Request verification'} onPress={go('verification')} />
            <ListItem icon={Megaphone} title="Promotions" onPress={go('promotions')} />
            <ListItem icon={History} title="House membership" onPress={go('membership')} />
            <ListItem icon={History} title="Staff activity" onPress={go('activity')} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
