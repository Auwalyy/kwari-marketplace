import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShopDto } from '@kkdm/shared';
import { Badge, Body, Button, Card, Heading, Notice, Screen, SectionHeader, TextField, VerificationBadge, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface MyVerification { id: string; type: string; targetId: string; status: string; decisionReason?: string; appeal?: { statement: string } | null; createdAt: string }

/** Shop verification and ownership-transfer requests (reviewed by administrators). */
export default function ShopVerification() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<ShopDto>(`/shops/${shopId}`) });
  const mine = useQuery({ queryKey: ['verifications', 'mine'], queryFn: () => api.get<MyVerification[]>('/verifications/mine') });
  const [evidence, setEvidence] = useState('');
  const [transfer, setTransfer] = useState({ to: '', evidence: '' });
  const [appeal, setAppeal] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['verifications'] });
    void shop.refetch();
  };
  const request = useMutation({ mutationFn: () => api.post('/verifications', { type: 'shop', targetId: shopId, evidence }), onSuccess: () => { setEvidence(''); toast.success('Verification requested'); refresh(); }, onError: (e) => toast.apiError(e) });
  const requestTransfer = useMutation({ mutationFn: () => api.post(`/shops/${shopId}/ownership-transfer`, { newOwnerIdentifier: transfer.to, evidence: transfer.evidence }), onSuccess: () => { setTransfer({ to: '', evidence: '' }); toast.success('Transfer request submitted for review'); refresh(); }, onError: (e) => toast.apiError(e) });
  const sendAppeal = useMutation({ mutationFn: (id: string) => api.post(`/verifications/${id}/appeal`, { statement: appeal }), onSuccess: () => { setAppeal(''); refresh(); }, onError: (e) => toast.apiError(e) });

  const requests = (mine.data ?? []).filter((v) => v.targetId === shopId);
  const pending = requests.some((r) => r.status === 'pending' && r.type === 'shop');

  return (
    <Screen title="Verification & ownership" onRefresh={refresh} refreshing={mine.isRefetching}>
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <Heading>Shop verification</Heading>
          {shop.data ? <VerificationBadge status={shop.data.verificationStatus} /> : null}
        </View>
        <Body className="mt-2 text-sm">A verified badge tells customers the platform has checked that your shop exists at this location and is run by you. Your invitation code alone is not proof.</Body>
      </Card>
      {shop.data?.verificationStatus !== 'verified' && !pending ? (
        <>
          <TextField label="Evidence" multiline value={evidence} onChangeText={setEvidence} placeholder="CAC registration number, market levy receipt numbers, how long you have occupied the shop…" />
          <Button title="Request verification" onPress={() => request.mutate()} loading={request.isPending} disabled={evidence.trim().length < 10} fullWidth />
        </>
      ) : null}

      <SectionHeader title="Requests" />
      {requests.length ? (
        requests.map((r) => (
          <Card key={r.id} className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{r.type === 'shop_ownership' ? 'Ownership transfer' : 'Shop verification'}</Text>
              <Badge label={r.status} tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'} />
            </View>
            <Text className="text-xs text-ink-500">Submitted {formatDate(r.createdAt)}</Text>
            {r.decisionReason ? <Text className="mt-1 text-sm text-ink-700">Decision: {r.decisionReason}</Text> : null}
            {r.status === 'rejected' && !r.appeal ? (
              <>
                <TextField containerClassName="mt-2" label="Appeal statement" multiline value={appeal} onChangeText={setAppeal} />
                <Button title="Submit appeal" size="sm" variant="outline" onPress={() => sendAppeal.mutate(r.id)} disabled={appeal.trim().length < 10} />
              </>
            ) : null}
          </Card>
        ))
      ) : (
        <Text className="text-sm text-ink-500">No requests yet.</Text>
      )}

      <SectionHeader title="Transfer ownership" />
      <Notice tone="warning">Transfers are reviewed by an administrator before taking effect. The new owner must already have an account.</Notice>
      <TextField label="New owner’s email or phone" value={transfer.to} onChangeText={(t) => setTransfer((x) => ({ ...x, to: t }))} autoCapitalize="none" />
      <TextField label="Reason and evidence" multiline value={transfer.evidence} onChangeText={(t) => setTransfer((x) => ({ ...x, evidence: t }))} />
      <Button title="Request transfer" variant="outline" onPress={() => requestTransfer.mutate()} loading={requestTransfer.isPending} disabled={transfer.to.length < 3 || transfer.evidence.trim().length < 10} fullWidth />
    </Screen>
  );
}
