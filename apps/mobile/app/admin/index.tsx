import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  BadgeCheck,
  Building2,
  ClipboardList,
  CreditCard,
  FileSearch,
  Gavel,
  Handshake,
  KeyRound,
  Layers,
  Map,
  Megaphone,
  Package,
  Settings,
  Store,
  Users,
} from 'lucide-react-native';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@kkdm/shared';
import { Card, ErrorState, KeyValue, ListItem, LoadingView, Screen, SectionHeader } from '@/components/ui';
import { StatTile } from '@/components/charts';
import { api } from '@/lib/api';
import { formatNaira } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface Dashboard {
  users: Record<string, number> | null;
  houses: number;
  shops: Record<string, number>;
  publishedProducts: number;
  orders30d: { counts: Record<string, number>; valueKobo: Record<string, number> };
  payments30d: { counts: Record<string, number>; totalKobo: Record<string, number> } | null;
  queues: { openReports: number; pendingVerifications: number; pendingMemberships: number };
  invitationAbuse: { failedAttempts24h: number };
  activityBySection: { sectionId: string | null; name: string; shops: number }[];
  activityByHouse: { houseId: string; houseNumber: string; orders: number; valueKobo: number }[];
}

export default function AdminDashboard() {
  const isAdmin = useAuth((s) => s.user?.platformRoles.includes('admin'));
  const q = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.get<Dashboard>('/admin/dashboard') });
  if (q.isPending) return <Screen title="Administration"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Administration"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const d = q.data;
  const totalUsers = d.users ? Object.values(d.users).reduce((a, b) => a + b, 0) : null;
  const go = (p: string) => () => router.push(`/admin/${p}` as never);
  return (
    <Screen title="Administration" subtitle={isAdmin ? 'Platform administrator' : 'Market manager (scoped)'} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} padded={false}>
      <View className="px-4">
        <View className="flex-row flex-wrap justify-between">
          {totalUsers != null ? <StatTile label="Registered users" value={String(totalUsers)} hint={`${d.users?.suspended ?? 0} suspended`} /> : null}
          <StatTile label="Houses" value={String(d.houses)} />
          <StatTile label="Active shops" value={String(d.shops.active ?? 0)} hint={`${d.shops.pending_membership ?? 0} pending`} />
          <StatTile label="Published products" value={String(d.publishedProducts)} />
          <StatTile label="Open reports" value={String(d.queues.openReports)} />
          <StatTile label="Verifications waiting" value={String(d.queues.pendingVerifications)} />
          <StatTile label="Failed code attempts (24h)" value={String(d.invitationAbuse.failedAttempts24h)} hint="Invitation abuse indicator" />
          <StatTile label="Pending memberships" value={String(d.queues.pendingMemberships)} />
        </View>
        <SectionHeader title="Orders (30 days)" />
        <Card>
          {Object.entries(d.orders30d.counts).length ? Object.entries(d.orders30d.counts).map(([k, v]) => <KeyValue key={k} label={ORDER_STATUS_LABELS[k as OrderStatus] ?? k} value={`${v} · ${formatNaira(d.orders30d.valueKobo[k] ?? 0)}`} />) : <Text className="text-sm text-ink-500">No orders.</Text>}
        </Card>
        {d.payments30d ? (
          <>
            <SectionHeader title="Payments (30 days)" />
            <Card>
              {Object.entries(d.payments30d.counts).length ? Object.entries(d.payments30d.counts).map(([k, v]) => <KeyValue key={k} label={k.replace('_', ' ')} value={`${v} · ${formatNaira(d.payments30d!.totalKobo[k] ?? 0)}`} />) : <Text className="text-sm text-ink-500">No payments.</Text>}
            </Card>
          </>
        ) : null}
        <SectionHeader title="Activity by section" />
        <Card>{d.activityBySection.map((s) => <KeyValue key={s.sectionId ?? 'none'} label={s.name} value={`${s.shops} shops`} />)}</Card>
        <SectionHeader title="Busiest houses (30 days)" />
        <Card>{d.activityByHouse.length ? d.activityByHouse.map((h) => <KeyValue key={h.houseId} label={`House ${h.houseNumber}`} value={`${h.orders} orders · ${formatNaira(h.valueKobo)}`} />) : <Text className="text-sm text-ink-500">No orders yet.</Text>}</Card>
      </View>
      <View className="mt-4 border-y border-line">
        <ListItem icon={BadgeCheck} title="Verification queue" subtitle={`${d.queues.pendingVerifications} waiting`} onPress={go('verifications')} />
        <ListItem icon={AlertOctagon} title="Reports" subtitle={`${d.queues.openReports} open`} onPress={go('reports')} />
        <ListItem icon={Gavel} title="Membership disputes" onPress={go('disputes')} />
        <ListItem icon={Map} title="Markets & sections" onPress={go('markets')} />
        <ListItem icon={Building2} title="Houses & house heads" onPress={go('houses')} />
        <ListItem icon={Store} title="Shops" onPress={go('shops')} />
        <ListItem icon={Package} title="Product moderation" onPress={go('products')} />
        <ListItem icon={ClipboardList} title="Orders" onPress={go('orders')} />
        <ListItem icon={KeyRound} title="Invitation monitoring" onPress={go('invitations')} />
        {isAdmin ? (
          <>
            <ListItem icon={Users} title="Users & roles" onPress={go('users')} />
            <ListItem icon={Handshake} title="Resellers" subtitle="Applications and approved resellers" onPress={go('resellers')} />
            <ListItem icon={CreditCard} title="Payments & refunds" onPress={go('payments')} />
            <ListItem icon={Layers} title="Categories" onPress={go('categories')} />
            <ListItem icon={Megaphone} title="Promotions & announcements" onPress={go('promotions')} />
            <ListItem icon={Settings} title="Platform settings" onPress={go('settings')} />
            <ListItem icon={FileSearch} title="Audit log" onPress={go('audit')} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
