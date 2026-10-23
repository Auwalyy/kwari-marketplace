import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ResellerMeDto, ResellerStatus } from '@kkdm/shared';
import { Badge, Button, Card, PaginatedList, Screen, SegmentedControl, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

type Row = ResellerMeDto & { user: { id: string; fullName: string; email?: string; phone?: string } };
const TONE: Record<ResellerStatus, 'gold' | 'success' | 'danger' | 'neutral'> = { pending: 'gold', approved: 'success', rejected: 'danger', suspended: 'neutral' };

/** Reseller applications. Approval lets a person see reseller prices, so check who they are first. */
export default function AdminResellers() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<ResellerStatus>('pending');
  const decide = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approve' | 'reject' | 'suspend'; reason?: string }) => api.post(`/admin/resellers/${id}/decision`, { decision, reason }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'resellers'] });
      toast.success(v.decision === 'approve' ? 'Approved — they have been notified' : 'Done');
    },
    onError: (e) => toast.apiError(e),
  });
  const withReason = async (id: string, decision: 'reject' | 'suspend') => {
    const r = await confirm({
      title: decision === 'reject' ? 'Reject this application?' : 'Suspend this reseller?',
      message: decision === 'suspend' ? 'Their products disappear from customers until you approve them again.' : 'They will see your reason and can apply again.',
      destructive: true,
      confirmLabel: decision === 'reject' ? 'Reject' : 'Suspend',
      reason: { placeholder: 'Reason the person can act on', required: true },
    });
    if (r.confirmed && r.reason) decide.mutate({ id, decision, reason: r.reason });
  };

  return (
    <Screen title="Resellers" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SegmentedControl
          options={[
            { value: 'pending', label: 'Waiting' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'suspended', label: 'Suspended' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </View>
      <PaginatedList<Row>
        key={status}
        queryKey={['admin', 'resellers', status]}
        fetchPage={(page) => api.page<Row>('/admin/resellers', { page, status })}
        keyOf={(r) => r.id}
        renderItem={(r) => (
          <Card className="mb-2">
            <View className="flex-row items-start justify-between">
              <View className="mr-2 flex-1">
                <Text className="text-base font-bold text-ink-900">{r.businessName}</Text>
                <Text className="text-sm text-ink-600">
                  {r.user.fullName}
                  {r.user.email ? ` · ${r.user.email}` : ''}
                </Text>
                <Text className="text-sm text-ink-600">
                  {r.phone}
                  {r.area ? ` · ${r.area}` : ''}
                </Text>
              </View>
              <Badge label={r.status} tone={TONE[r.status]} />
            </View>
            {r.about ? <Text className="mt-2 text-sm text-ink-700">{r.about}</Text> : null}
            <Text className="mt-1 text-xs text-ink-400">
              Applied {formatDate(r.appliedAt)} · {r.listingCount} product{r.listingCount === 1 ? '' : 's'}
              {r.decisionReason ? ` · ${r.decisionReason}` : ''}
            </Text>
            <View className="mt-3 flex-row">
              {r.status !== 'approved' ? <Button title="Approve" size="sm" className="mr-2" onPress={() => decide.mutate({ id: r.id, decision: 'approve' })} /> : null}
              {r.status === 'pending' ? <Button title="Reject" variant="outline" size="sm" onPress={() => void withReason(r.id, 'reject')} /> : null}
              {r.status === 'approved' ? <Button title="Suspend" variant="outline" size="sm" onPress={() => void withReason(r.id, 'suspend')} /> : null}
            </View>
          </Card>
        )}
        empty={{ title: status === 'pending' ? 'No applications waiting' : 'Nobody here' }}
      />
    </Screen>
  );
}
