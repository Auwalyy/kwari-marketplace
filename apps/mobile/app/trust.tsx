import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Divider, ErrorState, Screen, SectionHeader, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/format';

interface ReportRow { id: string; targetType: string; category: string; description: string; status: string; resolution?: string; createdAt: string }
interface BlockRow { id: string; blockedType: string; blockedId: string; name?: string; createdAt: string }

/** The user's reports and blocked accounts. */
export default function Trust() {
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ['reports', 'mine'], queryFn: () => api.get<ReportRow[]>('/reports/mine') });
  const blocks = useQuery({ queryKey: ['blocks'], queryFn: () => api.get<BlockRow[]>('/blocks') });
  const unblock = useMutation({ mutationFn: (id: string) => api.del(`/blocks/${id}`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Unblocked'); } });
  return (
    <Screen title="Reports & blocks" onRefresh={() => { void reports.refetch(); void blocks.refetch(); }} refreshing={reports.isRefetching}>
      <SectionHeader title="Blocked" />
      {blocks.isError ? <ErrorState error={blocks.error} compact onRetry={() => blocks.refetch()} /> : null}
      {blocks.data?.length ? (
        <Card>
          {blocks.data.map((b, i) => (
            <View key={b.id}>
              {i ? <Divider /> : null}
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-semibold text-ink-900">{b.name ?? b.blockedId}</Text>
                  <Text className="text-xs text-ink-500">{b.blockedType} · since {formatDate(b.createdAt)}</Text>
                </View>
                <Button title="Unblock" size="sm" variant="outline" onPress={() => unblock.mutate(b.id)} />
              </View>
            </View>
          ))}
        </Card>
      ) : (
        <Text className="text-sm text-ink-500">You haven’t blocked anyone.</Text>
      )}
      <SectionHeader title="My reports" />
      {reports.data?.length ? (
        reports.data.map((r) => (
          <Card key={r.id} className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{titleCase(r.category)} · {r.targetType}</Text>
              <Badge label={r.status} tone={r.status === 'resolved' ? 'success' : r.status === 'dismissed' ? 'neutral' : 'warning'} />
            </View>
            <Text className="mt-1 text-sm text-ink-600">{r.description}</Text>
            {r.resolution ? <Text className="mt-1 text-xs text-ink-500">Outcome: {r.resolution}</Text> : null}
            <Text className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)}</Text>
          </Card>
        ))
      ) : (
        <Text className="text-sm text-ink-500">No reports submitted.</Text>
      )}
    </Screen>
  );
}
