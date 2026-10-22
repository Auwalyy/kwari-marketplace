import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel } from 'lucide-react-native';
import type { HouseMembershipDto } from '@kkdm/shared';
import { Badge, Button, Card, EmptyState, ErrorState, ListSkeleton, Screen, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** House membership disputes awaiting an administrator decision. */
export default function Disputes() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'disputes'], queryFn: () => api.get<HouseMembershipDto[]>('/admin/disputes') });
  const resolve = useMutation({
    mutationFn: ({ id, resolution, reinstate }: { id: string; resolution: string; reinstate: boolean }) => api.post(`/admin/disputes/${id}/resolve`, { resolution, reinstate }),
    onSuccess: () => { toast.success('Dispute resolved'); void qc.invalidateQueries({ queryKey: ['admin', 'disputes'] }); },
    onError: (e) => toast.apiError(e),
  });
  const run = async (m: HouseMembershipDto, reinstate: boolean) => {
    const r = await confirm({ title: reinstate ? 'Reinstate the shop in this house?' : 'Uphold the house’s decision?', reason: { placeholder: 'Resolution (shared with both parties)', required: true, minLength: 5 }, confirmLabel: 'Resolve' });
    if (r.confirmed && r.reason) resolve.mutate({ id: m.id, resolution: r.reason, reinstate });
  };
  return (
    <Screen title="Membership disputes" onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {q.isPending ? <ListSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon={Gavel} title="No open disputes" /> : null}
      {q.data?.map((m) => (
        <Card key={m.id} className="mb-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink-900">{m.shop.name} (Shop {m.shop.shopNumber})</Text>
            <Badge label={m.dispute?.status ?? ''} tone="danger" />
          </View>
          <Text className="text-xs text-ink-500">Membership {m.status} · {m.reason ?? 'no reason given'} · opened {formatDate(m.dispute?.openedAt)}</Text>
          {m.dispute?.statement ? <Text className="mt-2 text-sm text-ink-700">Shop owner: {m.dispute.statement}</Text> : null}
          {m.dispute?.response ? <Text className="mt-1 text-sm text-ink-700">House head: {m.dispute.response}</Text> : <Text className="mt-1 text-xs text-ink-400">The house has not responded yet.</Text>}
          <View className="mt-3 flex-row">
            <Button title="Reinstate shop" size="sm" className="mr-2" onPress={() => void run(m, true)} />
            <Button title="Uphold decision" size="sm" variant="outline" onPress={() => void run(m, false)} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
