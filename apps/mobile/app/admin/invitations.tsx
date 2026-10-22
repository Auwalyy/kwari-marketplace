import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, ChoiceChips, KeyValue, PaginatedList, Screen, SectionHeader, SegmentedControl, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';

interface Abuse {
  hours: number;
  byUser: { userId: string; fullName?: string; status?: string; failures: number; lastAt: string }[];
  byIp: { ip: string; failures: number; distinctUsers: number; lastAt: string }[];
  byReason: Record<string, number>;
}
interface Inv { id: string; houseId?: string; shopId?: string; codePreview: string; status: string; expiresAt: string; usedCount: number; maxUses: number; createdAt: string; redemptions: number }

/** Invitation monitoring and abuse indicators (failed / guessed codes). */
export default function AdminInvitations() {
  const qc = useQueryClient();
  const [hours, setHours] = useState('24');
  const [kind, setKind] = useState<'house' | 'worker'>('house');
  const abuse = useQuery({ queryKey: ['admin', 'abuse', hours], queryFn: () => api.get<Abuse>('/admin/invitations/abuse', { hours }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/admin/invitations/${kind}/${id}/revoke`), onSuccess: () => { toast.success('Revoked'); void qc.invalidateQueries({ queryKey: ['admin', 'invitations'] }); }, onError: (e) => toast.apiError(e) });
  const a = abuse.data;
  return (
    <Screen title="Invitations" scroll={false} padded={false}>
      <PaginatedList<Inv>
        key={kind}
        queryKey={['admin', 'invitations', kind]}
        fetchPage={(page) => api.page<Inv>('/admin/invitations', { kind, page })}
        keyOf={(i) => i.id}
        header={
          <View>
            <SectionHeader title="Abuse indicators" />
            <ChoiceChips options={[{ value: '24', label: '24 hours' }, { value: '168', label: '7 days' }, { value: '720', label: '30 days' }]} value={hours} onChange={(v) => v && setHours(v)} />
            <Card className="mb-2">
              <Text className="mb-1 font-semibold text-ink-900">Failed attempts by reason</Text>
              {a && Object.keys(a.byReason).length ? Object.entries(a.byReason).map(([k, v]) => <KeyValue key={k} label={titleCase(k)} value={String(v)} />) : <Text className="text-sm text-ink-500">No failed attempts.</Text>}
            </Card>
            {a?.byUser.length ? (
              <Card className="mb-2">
                <Text className="mb-1 font-semibold text-ink-900">Accounts with repeated failures</Text>
                {a.byUser.map((u) => <KeyValue key={u.userId} label={`${u.fullName ?? u.userId} (${u.status})`} value={`${u.failures} · ${formatDateTime(u.lastAt)}`} />)}
              </Card>
            ) : null}
            {a?.byIp.length ? (
              <Card className="mb-2">
                <Text className="mb-1 font-semibold text-ink-900">By network address</Text>
                {a.byIp.map((x) => <KeyValue key={x.ip} label={`${x.ip} (${x.distinctUsers} accounts)`} value={String(x.failures)} />)}
              </Card>
            ) : null}
            <SectionHeader title="All invitations" />
            <SegmentedControl options={[{ value: 'house', label: 'House → shop' }, { value: 'worker', label: 'Shop → worker' }]} value={kind} onChange={setKind} />
          </View>
        }
        renderItem={(i) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{i.codePreview}</Text>
              <Badge label={i.status} tone={i.status === 'active' ? 'success' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">Used {i.usedCount}/{i.maxUses} · created {formatDate(i.createdAt)} · expires {formatDate(i.expiresAt)}</Text>
            {i.status === 'active' ? <Button title="Revoke" size="sm" variant="ghost" className="mt-1 self-start" onPress={() => revoke.mutate(i.id)} /> : null}
          </Card>
        )}
        empty={{ title: 'No invitations' }}
      />
    </Screen>
  );
}
