import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ClipboardCheck, History, KeyRound, Pencil, Store, Ticket } from 'lucide-react-native';
import type { HouseDto } from '@kkdm/shared';
import { Badge, Card, ErrorState, ListItem, LoadingView, Notice, Screen, SectionHeader, VerificationBadge } from '@/components/ui';
import { StatTile } from '@/components/charts';
import { api } from '@/lib/api';
import { timeAgo, titleCase } from '@/lib/format';

interface Dashboard {
  house: HouseDto;
  headVerificationStatus: string;
  shops: { total: number; active: number; pending: number };
  membershipRequests: Record<string, number>;
  verification: Record<string, number>;
  invitations: { created: number; redeemed: number; active: number };
  recentActivity: { id: string; action: string; reason?: string; at: string }[];
}

export default function HouseDashboard() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  const q = useQuery({ queryKey: ['house-dashboard', houseId], queryFn: () => api.get<Dashboard>(`/houses/${houseId}/dashboard`) });
  if (q.isPending) return <Screen title="House"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="House"><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const d = q.data;
  const pendingRequests = d.membershipRequests.pending ?? 0;
  const go = (p: string) => () => router.push(`/house-admin/${houseId}/${p}` as never);
  return (
    <Screen title={`House ${d.house.houseNumber}`} subtitle={d.house.name} onRefresh={() => void q.refetch()} refreshing={q.isRefetching} padded={false}>
      <View className="px-4">
        {d.headVerificationStatus !== 'verified' ? <Notice tone="warning" title="Head not yet verified">You can manage the house profile, but you can issue shop invitation codes only after an administrator verifies you as house head.</Notice> : null}
        <View className="mb-2 flex-row items-center">
          <VerificationBadge status={d.house.verificationStatus} />
          <Badge label={`Head: ${d.headVerificationStatus}`} tone={d.headVerificationStatus === 'verified' ? 'success' : 'warning'} className="ml-2" />
        </View>
        <Text className="mb-3 text-sm text-ink-500">{d.house.breadcrumb.label}</Text>
        <View className="flex-row flex-wrap justify-between">
          <StatTile label="Active shops" value={String(d.shops.active)} />
          <StatTile label="Awaiting approval" value={String(pendingRequests)} hint="membership requests" />
          <StatTile label="Active invitations" value={String(d.invitations.active)} hint={`${d.invitations.redeemed} redeemed of ${d.invitations.created} created`} />
          <StatTile label="Verified shops" value={String(d.verification.verified ?? 0)} hint={`${d.verification.pending ?? 0} pending`} />
        </View>
      </View>
      <View className="mt-2 border-y border-line">
        <ListItem icon={ClipboardCheck} title="Membership requests" subtitle={pendingRequests ? `${pendingRequests} waiting for you` : 'Approve or reject shops'} onPress={() => router.push({ pathname: `/house-admin/${houseId}/shops`, params: { status: 'pending' } } as never)} />
        <ListItem icon={Store} title="Shops in this house" onPress={go('shops')} />
        <ListItem icon={KeyRound} title="Create shop invitation" onPress={go('invite')} />
        <ListItem icon={Ticket} title="Manage invitations" onPress={go('invitations')} />
        <ListItem icon={Pencil} title="House profile & assistants" onPress={go('edit')} />
        <ListItem icon={BadgeCheck} title="Verification & disputes" onPress={go('verification')} />
        <ListItem icon={History} title="Activity history" onPress={go('activity')} />
      </View>
      <View className="px-4">
        <SectionHeader title="Recent activity" />
        <Card>
          {d.recentActivity.length ? d.recentActivity.map((a) => (
            <Text key={a.id} className="mb-1 text-xs text-ink-600">{timeAgo(a.at)} · {titleCase(a.action)}{a.reason ? ` — ${a.reason}` : ''}</Text>
          )) : <Text className="text-sm text-ink-500">No activity yet.</Text>}
        </Card>
      </View>
    </Screen>
  );
}
