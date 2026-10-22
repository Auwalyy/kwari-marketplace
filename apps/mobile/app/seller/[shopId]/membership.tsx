import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseMembershipDto } from '@kkdm/shared';
import { Badge, Body, Button, Card, ErrorState, Heading, LoadingView, Notice, PendingBanner, Screen, SectionHeader, TextField, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useAuth } from '@/store/auth';

type Membership = HouseMembershipDto & { history: { status: string; reason?: string; at: string }[] };

/** House membership status (pending screen), history, disputes and re-joining with a new code. */
export default function ShopMembership() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refreshUser = useAuth((s) => s.refreshUser);
  const [code, setCode] = useState('');
  const list = useQuery({ queryKey: ['membership', shopId], queryFn: () => api.get<Membership[]>(`/shops/${shopId}/house-membership`), refetchInterval: 30_000 });
  const rejoin = useMutation({
    mutationFn: () => api.post(`/shops/${shopId}/house-membership`, { code }),
    onSuccess: async () => {
      setCode('');
      await refreshUser();
      void qc.invalidateQueries({ queryKey: ['membership', shopId] });
      toast.success('Request sent to the house');
    },
    onError: (e) => toast.apiError(e),
  });
  const dispute = useMutation({
    mutationFn: ({ id, statement }: { id: string; statement: string }) => api.post(`/shops/${shopId}/house-membership/${id}/dispute`, { statement }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['membership', shopId] });
      toast.success('Dispute submitted');
    },
    onError: (e) => toast.apiError(e),
  });

  if (list.isPending) return <Screen title="House membership"><LoadingView /></Screen>;
  if (list.isError) return <Screen title="House membership"><ErrorState error={list.error} onRetry={() => list.refetch()} /></Screen>;
  const current = list.data[0];
  const live = current && (current.status === 'pending' || current.status === 'approved');

  return (
    <Screen title="House membership" subtitle={current?.shop.name} onRefresh={() => void list.refetch()} refreshing={list.isRefetching}>
      {current?.status === 'pending' ? <PendingBanner text="Waiting for the house head to approve your shop. You’ll get a notification when they decide." /> : null}
      {current?.status === 'approved' ? (
        <Notice tone="success" title="Approved">Your shop is listed in the market directory.</Notice>
      ) : null}
      {current && ['rejected', 'removed'].includes(current.status) ? <Notice tone="danger" title={current.status === 'rejected' ? 'Registration declined' : 'Removed from house'}>{current.reason ?? 'No reason was given.'}</Notice> : null}

      {list.data.map((m) => (
        <Card key={m.id} className="mb-3">
          <View className="flex-row items-center justify-between">
            <Heading className="text-base">Request of {formatDate(m.createdAt)}</Heading>
            <Badge label={m.status} tone={m.status === 'approved' ? 'success' : m.status === 'pending' ? 'warning' : 'danger'} />
          </View>
          {m.history.map((h, i) => (
            <Text key={i} className="mt-1 text-xs text-ink-600">
              {formatDateTime(h.at)} · {h.status}
              {h.reason ? ` — ${h.reason}` : ''}
            </Text>
          ))}
          {m.dispute ? (
            <View className="mt-3 rounded-xl bg-cream-100 p-3">
              <Text className="text-sm font-semibold text-ink-900">Dispute: {m.dispute.status}</Text>
              {m.dispute.statement ? <Text className="mt-1 text-sm text-ink-700">You: {m.dispute.statement}</Text> : null}
              {m.dispute.response ? <Text className="mt-1 text-sm text-ink-700">House: {m.dispute.response}</Text> : null}
              {m.dispute.resolution ? <Text className="mt-1 text-sm text-ink-700">Resolution: {m.dispute.resolution}</Text> : null}
            </View>
          ) : ['rejected', 'removed'].includes(m.status) ? (
            <Button
              title="Dispute this decision"
              variant="outline"
              size="sm"
              className="mt-3 self-start"
              onPress={async () => {
                const r = await confirm({ title: 'Open a dispute', message: 'Explain why the decision is wrong. The house head can respond and an administrator will review.', reason: { placeholder: 'Your statement', required: true, minLength: 10 }, confirmLabel: 'Submit' });
                if (r.confirmed && r.reason) dispute.mutate({ id: m.id, statement: r.reason });
              }}
            />
          ) : null}
        </Card>
      ))}

      {!live ? (
        <>
          <SectionHeader title="Join a house with a new code" />
          <Body className="mb-3 text-sm">If your shop moved, or you resolved the issue with the house head, ask for a new invitation code.</Body>
          <TextField label="House invitation code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
          <Button title="Send request" onPress={() => rejoin.mutate()} loading={rejoin.isPending} disabled={code.replace(/[\s-]/g, '').length < 8} fullWidth />
        </>
      ) : current?.status === 'approved' ? (
        <Button title="Go to shop dashboard" onPress={() => router.replace(`/seller/${shopId}`)} fullWidth />
      ) : null}
    </Screen>
  );
}
