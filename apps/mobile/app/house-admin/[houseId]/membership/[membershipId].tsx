import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseMembershipDto } from '@kkdm/shared';
import { Badge, Button, Card, ErrorState, Heading, KeyValue, LoadingView, Notice, Screen, SectionHeader, VerificationBadge, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

type Detail = HouseMembershipDto & {
  history: { status: string; reason?: string; at: string }[];
  shopDetails: { shopCode: string; description?: string; locationDescription?: string; contactPhone?: string; verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected'; ownershipVerificationStatus: string; registeredAt: string } | null;
};

/** Review a shop's membership: approve / reject, remove, respond to disputes. */
export default function MembershipDetail() {
  const { houseId, membershipId } = useLocalSearchParams<{ houseId: string; membershipId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['house-membership', membershipId], queryFn: () => api.get<Detail>(`/houses/${houseId}/memberships/${membershipId}`) });
  const done = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['house-memberships', houseId] });
    void qc.invalidateQueries({ queryKey: ['house-dashboard', houseId] });
  };
  const decide = useMutation({ mutationFn: (b: { decision: 'approve' | 'reject'; reason?: string }) => api.post(`/houses/${houseId}/memberships/${membershipId}/decision`, b), onSuccess: () => { toast.success('Decision saved'); done(); }, onError: (e) => toast.apiError(e) });
  const remove = useMutation({ mutationFn: (reason: string) => api.post(`/houses/${houseId}/memberships/${membershipId}/remove`, { reason }), onSuccess: () => { toast.success('Shop removed from house'); done(); }, onError: (e) => toast.apiError(e) });
  const respond = useMutation({ mutationFn: (response: string) => api.post(`/houses/${houseId}/memberships/${membershipId}/dispute-response`, { response }), onSuccess: done, onError: (e) => toast.apiError(e) });

  if (q.isPending) return <Screen title="Membership"><LoadingView /></Screen>;
  if (q.isError) return <Screen title="Membership"><ErrorState error={q.error} /></Screen>;
  const m = q.data;
  return (
    <Screen title={m.shop.name} subtitle={`Shop ${m.shop.shopNumber}`} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Card className="mb-3">
        <View className="flex-row items-center justify-between">
          <Heading>{m.shop.name}</Heading>
          <Badge label={m.status} tone={m.status === 'approved' ? 'success' : m.status === 'pending' ? 'warning' : 'neutral'} />
        </View>
        <KeyValue label="Owner" value={m.shop.ownerName} />
        <KeyValue label="Shop number" value={m.shop.shopNumber} />
        {m.shopDetails ? (
          <>
            <KeyValue label="Shop code" value={m.shopDetails.shopCode} />
            <KeyValue label="Registered" value={formatDate(m.shopDetails.registeredAt)} />
            {m.shopDetails.locationDescription ? <KeyValue label="Location" value={m.shopDetails.locationDescription} /> : null}
            {m.shopDetails.contactPhone ? <KeyValue label="Phone" value={m.shopDetails.contactPhone} /> : null}
            <KeyValue label="Verification" value={<VerificationBadge status={m.shopDetails.verificationStatus} />} />
          </>
        ) : null}
      </Card>
      {m.status === 'pending' ? (
        <View className="mb-3 flex-row">
          <Button title="Approve" className="mr-2 flex-1" loading={decide.isPending && decide.variables?.decision === 'approve'} onPress={async () => (await confirm({ title: `Approve ${m.shop.name}?`, message: 'The shop will be listed in the market directory under your house.', confirmLabel: 'Approve' })).confirmed && decide.mutate({ decision: 'approve' })} />
          <Button
            title="Reject"
            variant="outline"
            className="flex-1"
            onPress={async () => {
              const r = await confirm({ title: 'Reject this registration?', destructive: true, confirmLabel: 'Reject', reason: { placeholder: 'Reason (shared with the shop owner)', required: true } });
              if (r.confirmed) decide.mutate({ decision: 'reject', reason: r.reason });
            }}
          />
        </View>
      ) : null}
      {m.status === 'approved' ? (
        <Button
          title="Remove shop from house"
          variant="ghost"
          className="mb-3"
          onPress={async () => {
            const r = await confirm({ title: 'Remove this shop?', message: 'It will be hidden from the directory until it joins a house again. The shop owner can dispute this.', destructive: true, confirmLabel: 'Remove', reason: { placeholder: 'Reason (required)', required: true, minLength: 5 } });
            if (r.confirmed && r.reason) remove.mutate(r.reason);
          }}
        />
      ) : null}
      {m.dispute ? (
        <>
          <SectionHeader title="Dispute" />
          <Card>
            <Badge label={m.dispute.status} tone={m.dispute.status === 'resolved' ? 'success' : 'danger'} />
            {m.dispute.statement ? <Text className="mt-2 text-sm text-ink-700">Shop: {m.dispute.statement}</Text> : null}
            {m.dispute.response ? <Text className="mt-1 text-sm text-ink-700">You: {m.dispute.response}</Text> : null}
            {m.dispute.resolution ? <Text className="mt-1 text-sm text-ink-700">Administrator: {m.dispute.resolution}</Text> : null}
            {m.dispute.status === 'open' ? (
              <Button
                title="Respond"
                size="sm"
                variant="outline"
                className="mt-3 self-start"
                onPress={async () => {
                  const r = await confirm({ title: 'Respond to dispute', reason: { placeholder: 'Your response (seen by the shop owner and administrators)', required: true, minLength: 5 }, confirmLabel: 'Send' });
                  if (r.confirmed && r.reason) respond.mutate(r.reason);
                }}
              />
            ) : null}
          </Card>
          <Notice tone="info">An administrator reviews disputes and makes the final decision.</Notice>
        </>
      ) : null}
      <SectionHeader title="History" />
      {m.history.map((h, i) => (
        <Text key={i} className="mb-1 text-xs text-ink-600">{formatDateTime(h.at)} · {h.status}{h.reason ? ` — ${h.reason}` : ''}</Text>
      ))}
    </Screen>
  );
}
