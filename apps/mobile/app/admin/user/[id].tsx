import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarketDto, PlatformRole, UserDto } from '@kkdm/shared';
import { Badge, Button, Card, ChoiceChips, ErrorState, KeyValue, LoadingView, Notice, Screen, SectionHeader, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';
import { formatDate } from '@/lib/format';

type Detail = UserDto & {
  suspendedReason?: string;
  lastLoginAt?: string | null;
  shopMemberships: { shopId: string; role: string; status: string }[];
  houseRoles: { houseId: string; role: string; status: string }[];
  orderCount: number;
  reportsAgainst: number;
};

/** User detail: suspension and platform-role / market-manager scope assignment (admins only). */
export default function AdminUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.get<Detail>(`/admin/users/${id}`) });
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api.page<MarketDto>('/markets', { limit: 50 }) });
  const [roles, setRoles] = useDerivedState<Detail, PlatformRole[]>(q.data, (d) => d.platformRoles, []);
  const [managed, setManaged] = useDerivedState<Detail, string[]>(q.data, (d) => d.managedMarketIds, []);

  const refresh = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  };
  const suspend = useMutation({ mutationFn: (reason: string) => api.post(`/admin/users/${id}/suspend`, { reason }), onSuccess: () => { toast.success('Suspended'); refresh(); }, onError: (e) => toast.apiError(e) });
  const reactivate = useMutation({ mutationFn: () => api.post(`/admin/users/${id}/reactivate`), onSuccess: () => { toast.success('Reactivated'); refresh(); }, onError: (e) => toast.apiError(e) });
  const saveRoles = useMutation({ mutationFn: (reason?: string) => api.put(`/admin/users/${id}/roles`, { platformRoles: roles, managedMarketIds: roles.includes('market_manager') ? managed : [], reason }), onSuccess: () => { toast.success('Roles updated'); refresh(); }, onError: (e) => toast.apiError(e) });

  if (q.isPending) return <Screen title="User"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="User"><ErrorState error={q.error} /></Screen>;
  const u = q.data;
  return (
    <Screen title={u.fullName} subtitle={u.email ?? u.phone ?? ''}>
      <Card className="mb-3">
        <KeyValue label="Status" value={<Badge label={u.status} tone={u.status === 'active' ? 'success' : 'danger'} />} />
        <KeyValue label="Joined" value={formatDate(u.createdAt)} />
        <KeyValue label="Last login" value={u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'} />
        <KeyValue label="Email verified" value={u.emailVerified ? 'Yes' : 'No'} />
        <KeyValue label="Phone verified" value={u.phoneVerified ? 'Yes' : 'No'} />
        <KeyValue label="Orders" value={String(u.orderCount)} />
        <KeyValue label="Reports against" value={String(u.reportsAgainst)} />
        <KeyValue label="Shop memberships" value={u.shopMemberships.map((m) => `${m.role} (${m.status})`).join(', ') || '—'} />
        <KeyValue label="House roles" value={u.houseRoles.map((h) => `${h.role} (${h.status})`).join(', ') || '—'} />
      </Card>
      {u.suspendedReason ? <Notice tone="danger" title="Suspended">{u.suspendedReason}</Notice> : null}
      {u.status === 'active' ? (
        <Button
          title="Suspend account"
          variant="danger"
          onPress={async () => {
            const r = await confirm({ title: 'Suspend this account?', message: 'All sessions are revoked immediately.', destructive: true, confirmLabel: 'Suspend', reason: { placeholder: 'Reason (recorded in the audit log)', required: true, minLength: 5 } });
            if (r.confirmed && r.reason) suspend.mutate(r.reason);
          }}
        />
      ) : u.status === 'suspended' ? (
        <Button title="Reactivate account" onPress={() => reactivate.mutate()} loading={reactivate.isPending} />
      ) : null}

      <SectionHeader title="Platform roles" />
      <ChoiceChips multiple options={[{ value: 'admin', label: 'Administrator' }, { value: 'market_manager', label: 'Market manager' }]} value={roles} onChange={(v: PlatformRole[]) => setRoles(v)} />
      {roles.includes('market_manager') ? (
        <ChoiceChips label="Markets this manager may manage" multiple options={(markets.data?.items ?? []).map((m) => ({ value: m.id, label: m.name }))} value={managed} onChange={(v: string[]) => setManaged(v)} />
      ) : null}
      <Text className="mb-3 text-xs text-ink-500">Market managers act only within their assigned markets and never gain administrator access automatically.</Text>
      <Button
        title="Save roles"
        variant="secondary"
        loading={saveRoles.isPending}
        onPress={async () => {
          const r = await confirm({ title: 'Change roles?', reason: { placeholder: 'Reason (optional, audited)' }, confirmLabel: 'Save' });
          if (r.confirmed) saveRoles.mutate(r.reason);
        }}
      />
    </Screen>
  );
}
