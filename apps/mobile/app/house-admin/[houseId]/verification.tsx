import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseDto, HouseMembershipDto } from '@kkdm/shared';
import { Badge, Body, Button, Card, Heading, Screen, SectionHeader, TextField, VerificationBadge, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface MyVerification { id: string; type: string; targetId: string; status: string; decisionReason?: string; createdAt: string }

/** House & house-head verification requests, plus open membership disputes. */
export default function HouseVerification() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  const qc = useQueryClient();
  const house = useQuery({ queryKey: ['house', houseId], queryFn: () => api.get<HouseDto>(`/houses/${houseId}`) });
  const mine = useQuery({ queryKey: ['verifications', 'mine'], queryFn: () => api.get<MyVerification[]>('/verifications/mine') });
  const disputes = useQuery({ queryKey: ['house-memberships', houseId, 'disputes'], queryFn: () => api.page<HouseMembershipDto>(`/houses/${houseId}/memberships`, { limit: 50 }) });
  const [evidence, setEvidence] = useState('');
  const request = useMutation({
    mutationFn: (type: 'house' | 'house_head') => api.post('/verifications', { type, targetId: houseId, evidence }),
    onSuccess: () => {
      setEvidence('');
      toast.success('Request submitted');
      void qc.invalidateQueries({ queryKey: ['verifications'] });
      void house.refetch();
    },
    onError: (e) => toast.apiError(e),
  });
  const requests = (mine.data ?? []).filter((v) => v.targetId === houseId);
  const open = (disputes.data?.items ?? []).filter((m) => m.dispute && m.dispute.status !== 'resolved');
  return (
    <Screen title="Verification & disputes">
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <Heading>House verification</Heading>
          {house.data ? <VerificationBadge status={house.data.verificationStatus} /> : null}
        </View>
        <Body className="mt-2 text-sm">Verification confirms the house record (number and location) and your role as head. Administrators review evidence before showing a badge.</Body>
      </Card>
      <TextField label="Evidence" multiline value={evidence} onChangeText={setEvidence} placeholder="Association letter, documents, people who can confirm…" />
      <View className="flex-row">
        <Button title="Verify house" variant="outline" className="mr-2 flex-1" disabled={evidence.trim().length < 10} onPress={() => request.mutate('house')} />
        <Button title="Verify me as head" className="flex-1" disabled={evidence.trim().length < 10} onPress={() => request.mutate('house_head')} />
      </View>
      <SectionHeader title="Requests" />
      {requests.length ? requests.map((r) => (
        <Card key={r.id} className="mb-2">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink-900">{r.type === 'house_head' ? 'House head' : 'House'}</Text>
            <Badge label={r.status} tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'} />
          </View>
          <Text className="text-xs text-ink-500">{formatDate(r.createdAt)}{r.decisionReason ? ` · ${r.decisionReason}` : ''}</Text>
        </Card>
      )) : <Text className="text-sm text-ink-500">No requests yet.</Text>}
      <SectionHeader title="Open disputes" />
      {open.length ? open.map((m) => (
        <Card key={m.id} className="mb-2" onPress={() => router.push(`/house-admin/${houseId}/membership/${m.id}`)}>
          <Text className="font-semibold text-ink-900">{m.shop.name}</Text>
          <Text className="text-xs text-ink-500">Dispute {m.dispute!.status} · tap to respond</Text>
        </Card>
      )) : <Text className="text-sm text-ink-500">No open disputes.</Text>}
    </Screen>
  );
}
