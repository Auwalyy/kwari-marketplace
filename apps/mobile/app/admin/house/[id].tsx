import { useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseDto, SectionDto } from '@kkdm/shared';
import { Badge, Button, Card, ChoiceChips, ErrorState, KeyValue, LoadingView, Screen, SectionHeader, SwitchRow, TextField, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';

interface AdminHouseRow { id: string; head: { id: string; fullName?: string; phone?: string } | null; headVerificationStatus: string; autoApproveMemberships: boolean; allowAssistants: boolean; verificationStatus: string; status: string }

/** House administration: structure, trust settings and head assignment. */
export default function AdminHouse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const house = useQuery({ queryKey: ['house', id], queryFn: () => api.get<HouseDto>(`/houses/${id}`) });
  const admin = useQuery({ queryKey: ['admin', 'houses', 'one', id], queryFn: () => api.get<AdminHouseRow>(`/admin/houses/${id}`) });
  const sections = useQuery({ queryKey: ['sections', house.data?.marketId], queryFn: () => api.get<SectionDto[]>(`/markets/${house.data!.marketId}/sections`), enabled: !!house.data });
  const [s, setS] = useDerivedState(
    admin.data,
    (a) => ({ sectionId: house.data?.sectionId ?? '', autoApprove: a.autoApproveMemberships, allowAssistants: a.allowAssistants, verificationStatus: a.verificationStatus, active: a.status === 'active' }),
    { sectionId: '', autoApprove: false, allowAssistants: false, verificationStatus: 'unverified', active: true },
  );
  const [identifier, setIdentifier] = useState('');

  const refresh = () => {
    void house.refetch();
    void admin.refetch();
    void qc.invalidateQueries({ queryKey: ['admin', 'houses'] });
  };
  const saveSettings = useMutation({
    mutationFn: (reason?: string) => api.patch(`/houses/${id}/admin`, { sectionId: s.sectionId || null, autoApproveMemberships: s.autoApprove, allowAssistants: s.allowAssistants, verificationStatus: s.verificationStatus, status: s.active ? 'active' : 'inactive', reason }),
    onSuccess: () => { toast.success('Saved'); refresh(); },
    onError: (e) => toast.apiError(e),
  });
  const assign = useMutation({
    mutationFn: async (markVerified: boolean) => {
      const user = await api.get<{ id: string; fullName: string; status: string }>('/admin/user-lookup', { identifier });
      return api.post(`/houses/${id}/head`, { userId: user.id, markVerified });
    },
    onSuccess: () => { toast.success('House head assigned'); setIdentifier(''); refresh(); },
    onError: (e) => toast.apiError(e),
  });
  const removeHead = useMutation({ mutationFn: (reason: string) => api.del(`/houses/${id}/head`, { reason }), onSuccess: () => { toast.success('Head removed'); refresh(); }, onError: (e) => toast.apiError(e) });

  if (house.isPending) return <Screen title="House"><LoadingView /></Screen>;
  if (house.isError) return <Screen title="House"><ErrorState error={house.error} /></Screen>;
  const h = house.data;
  return (
    <Screen title={`House ${h.houseNumber}`} subtitle={h.name}>
      <Card className="mb-3">
        <KeyValue label="Location" value={h.breadcrumb.label} />
        <KeyValue label="Shops" value={String(h.shopCount)} />
        <KeyValue label="Head" value={admin.data?.head ? `${admin.data.head.fullName ?? ''} ${admin.data.head.phone ?? ''}` : 'None'} />
        <KeyValue label="Head verification" value={<Badge label={admin.data?.headVerificationStatus ?? '—'} tone={admin.data?.headVerificationStatus === 'verified' ? 'success' : 'warning'} />} />
      </Card>
      <Button title="View house as public" variant="ghost" className="mb-2 self-start" onPress={() => router.push(`/house/${id}`)} />

      <SectionHeader title="House head" />
      <TextField label="Assign head by email or phone" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" />
      <Button title="Assign and mark verified" className="mb-2" disabled={identifier.length < 3} loading={assign.isPending && assign.variables === true} onPress={() => assign.mutate(true)} />
      <Button title="Assign (verification pending)" variant="outline" className="mb-2" disabled={identifier.length < 3} onPress={() => assign.mutate(false)} />
      {admin.data?.head ? (
        <Button
          title="Remove current head"
          variant="ghost"
          onPress={async () => {
            const r = await confirm({ title: 'Remove the house head?', message: 'Their active invitations are revoked too.', destructive: true, confirmLabel: 'Remove', reason: { placeholder: 'Reason', required: true } });
            if (r.confirmed && r.reason) removeHead.mutate(r.reason);
          }}
        />
      ) : null}

      <SectionHeader title="Structure & trust" />
      <ChoiceChips label="Section" options={[{ value: '', label: 'No section' }, ...(sections.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))]} value={s.sectionId} onChange={(v) => setS((x) => ({ ...x, sectionId: v ?? '' }))} />
      <ChoiceChips label="House record verification" options={['unverified', 'pending', 'verified', 'rejected'].map((v) => ({ value: v, label: v }))} value={s.verificationStatus} onChange={(v) => v && setS((x) => ({ ...x, verificationStatus: v }))} />
      <SwitchRow label="Auto-approve shop memberships" description="Valid invitation codes complete membership without house-head review. Only for trusted houses." value={s.autoApprove} onChange={(v) => setS((x) => ({ ...x, autoApprove: v }))} />
      <SwitchRow label="Allow house assistants" value={s.allowAssistants} onChange={(v) => setS((x) => ({ ...x, allowAssistants: v }))} />
      <SwitchRow label="House active" value={s.active} onChange={(v) => setS((x) => ({ ...x, active: v }))} />
      <Text className="mb-3 text-xs text-ink-500">Moving a house to another section updates all its shops and products.</Text>
      <Button
        title="Save settings"
        onPress={async () => {
          const r = await confirm({ title: 'Save house settings?', reason: { placeholder: 'Reason (audited)' }, confirmLabel: 'Save' });
          if (r.confirmed) saveSettings.mutate(r.reason);
        }}
        loading={saveSettings.isPending}
      />
    </Screen>
  );
}
