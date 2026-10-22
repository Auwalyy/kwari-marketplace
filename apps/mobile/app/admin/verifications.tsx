import { useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Chip, PaginatedList, Screen, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';

interface Request {
  id: string;
  type: string;
  targetId: string;
  targetLabel: string;
  requestedBy: { id: string; fullName?: string; phone?: string; email?: string };
  proposedOwner: { id: string; fullName?: string } | null;
  evidence: string;
  documentUrls: string[];
  status: string;
  appeal: { statement: string; at: string } | null;
  decisionReason?: string;
  history: { status: string; note?: string; at: string }[];
  createdAt: string;
}

/** Verification queue for house heads, houses, shops and ownership transfers (incl. appeals). */
export default function Verifications() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [type, setType] = useState<string | undefined>();
  const decide = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approve' | 'reject'; reason: string }) => api.post(`/admin/verifications/${id}/decision`, { decision, reason }),
    onSuccess: () => { toast.success('Decision recorded'); void qc.invalidateQueries({ queryKey: ['admin', 'verifications'] }); },
    onError: (e) => toast.apiError(e),
  });
  const run = async (r: Request, decision: 'approve' | 'reject') => {
    const res = await confirm({ title: decision === 'approve' ? 'Approve request?' : 'Reject request?', destructive: decision === 'reject', reason: { placeholder: 'Decision reason (sent to the requester)', required: true }, confirmLabel: decision === 'approve' ? 'Approve' : 'Reject' });
    if (res.confirmed && res.reason) decide.mutate({ id: r.id, decision, reason: res.reason });
  };
  return (
    <Screen title="Verification queue" scroll={false} padded={false}>
      <ScrollView horizontal className="max-h-14 pt-3" contentContainerStyle={{ paddingHorizontal: 16 }} showsHorizontalScrollIndicator={false}>
        {[undefined, 'house_head', 'house', 'shop', 'shop_ownership'].map((t) => <Chip key={t ?? 'all'} label={t ? titleCase(t) : 'All'} selected={type === t} onPress={() => setType(t)} />)}
      </ScrollView>
      <PaginatedList<Request>
        queryKey={['admin', 'verifications', type]}
        fetchPage={(page) => api.page<Request>('/admin/verifications', { type, page })}
        keyOf={(r) => r.id}
        renderItem={(r) => (
          <Card className="mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{titleCase(r.type)}</Text>
              <Badge label={r.status} tone={r.status === 'appealed' ? 'danger' : 'warning'} />
            </View>
            <Text className="mt-1 text-sm text-ink-800">{r.targetLabel}</Text>
            <Text className="text-xs text-ink-500">By {r.requestedBy.fullName} {r.requestedBy.phone ?? r.requestedBy.email ?? ''} · {formatDate(r.createdAt)}</Text>
            {r.proposedOwner ? <Text className="mt-1 text-sm text-ink-700">Proposed new owner: {r.proposedOwner.fullName}</Text> : null}
            <Text className="mt-2 rounded-lg bg-cream-100 p-2 text-sm text-ink-700">{r.evidence}</Text>
            {r.documentUrls.map((u) => <Text key={u} className="mt-1 text-xs text-info-500" onPress={() => void Linking.openURL(u)}>{u}</Text>)}
            {r.appeal ? <Text className="mt-2 text-sm text-danger-700">Appeal ({formatDateTime(r.appeal.at)}): {r.appeal.statement}</Text> : null}
            {r.decisionReason ? <Text className="mt-1 text-xs text-ink-500">Previous decision: {r.decisionReason}</Text> : null}
            <View className="mt-3 flex-row">
              <Button title="Approve" size="sm" className="mr-2" onPress={() => void run(r, 'approve')} />
              <Button title="Reject" size="sm" variant="outline" onPress={() => void run(r, 'reject')} />
            </View>
          </Card>
        )}
        empty={{ title: 'Queue is empty', message: 'Nothing waiting for review.' }}
      />
    </Screen>
  );
}
