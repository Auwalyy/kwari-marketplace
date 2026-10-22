import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react-native';
import { SHOP_PERMISSION_LABELS, type ShopPermission, type WorkerInvitationDto } from '@kkdm/shared';
import { Avatar, Badge, Button, Card, ErrorState, ListSkeleton, Screen, SectionHeader, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Worker {
  membershipId: string;
  userId: string;
  fullName: string;
  title?: string;
  role: 'owner' | 'worker';
  permissions: ShopPermission[];
  status: string;
  joinedAt: string;
  actionsLast30Days: number;
}

/** Workers, their permissions and invitation history (owner only). */
export default function Workers() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const workers = useQuery({ queryKey: ['workers', shopId], queryFn: () => api.get<Worker[]>(`/shops/${shopId}/workers`) });
  const invites = useQuery({ queryKey: ['worker-invitations', shopId], queryFn: () => api.page<WorkerInvitationDto>(`/shops/${shopId}/worker-invitations`, { limit: 30 }) });
  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.del(`/shops/${shopId}/workers/${id}`, { reason }),
    onSuccess: () => {
      toast.success('Access removed');
      void qc.invalidateQueries({ queryKey: ['workers', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/shops/${shopId}/worker-invitations/${id}/revoke`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['worker-invitations', shopId] }),
    onError: (e) => toast.apiError(e),
  });

  return (
    <Screen title="Workers" onRefresh={() => { void workers.refetch(); void invites.refetch(); }} refreshing={workers.isRefetching} footer={<Button title="Invite a worker" icon={UserPlus} onPress={() => router.push(`/seller/${shopId}/invite-worker`)} fullWidth />}>
      {workers.isPending ? <ListSkeleton rows={3} /> : workers.isError ? <ErrorState error={workers.error} onRetry={() => workers.refetch()} /> : null}
      {workers.data?.map((w) => (
        <Card key={w.membershipId} className="mb-3" onPress={w.role === 'worker' ? () => router.push(`/seller/${shopId}/worker/${w.membershipId}`) : undefined}>
          <View className="flex-row items-center">
            <Avatar name={w.fullName} />
            <View className="ml-3 flex-1">
              <Text className="font-semibold text-ink-900">{w.fullName}</Text>
              <Text className="text-xs text-ink-500">{w.role === 'owner' ? 'Owner' : (w.title ?? 'Worker')} · since {formatDate(w.joinedAt)} · {w.actionsLast30Days} actions (30d)</Text>
            </View>
            {w.role === 'owner' ? <Badge label="Owner" tone="info" /> : null}
          </View>
          {w.role === 'worker' ? (
            <>
              <View className="mt-2 flex-row flex-wrap">
                {w.permissions.map((p) => <Badge key={p} label={SHOP_PERMISSION_LABELS[p]} className="mb-1 mr-1" />)}
              </View>
              <View className="mt-2 flex-row">
                <Button title="Edit permissions" size="sm" variant="outline" className="mr-2" onPress={() => router.push(`/seller/${shopId}/worker/${w.membershipId}`)} />
                <Button
                  title="Remove"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    const r = await confirm({ title: `Remove ${w.fullName}?`, message: 'Their access ends immediately.', destructive: true, confirmLabel: 'Remove', reason: { placeholder: 'Reason (optional)' } });
                    if (r.confirmed) remove.mutate({ id: w.membershipId, reason: r.reason });
                  }}
                />
              </View>
            </>
          ) : null}
        </Card>
      ))}
      <SectionHeader title="Invitations" />
      {invites.data?.items.length ? (
        invites.data.items.map((i) => (
          <Card key={i.id} className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{i.codePreview} {i.title ? `· ${i.title}` : ''}</Text>
              <Badge label={i.status} tone={i.status === 'active' ? 'success' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">
              Used {i.usedCount}/{i.maxUses} · expires {formatDate(i.expiresAt)} · {i.permissions.length} permission(s)
            </Text>
            {i.status === 'active' ? <Button title="Revoke" size="sm" variant="ghost" className="mt-1 self-start" onPress={() => revoke.mutate(i.id)} /> : null}
          </Card>
        ))
      ) : (
        <Text className="text-sm text-ink-500">No invitations yet.</Text>
      )}
    </Screen>
  );
}
