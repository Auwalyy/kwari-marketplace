import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Chip, ChoiceChips, PaginatedList, Screen, SectionHeader, TextField, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, titleCase } from '@/lib/format';

interface Promo { id: string; type: string; shopId: string; productId: string | null; keywords: string[]; startsAt: string; endsAt: string; status: string; billing: string; note?: string; impressions: number; clicks: number }

/** Promotion approvals (with honest, measured performance) and announcements. */
export default function AdminPromotions() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = useState<string | undefined>('pending');
  const [ann, setAnn] = useState({ title: '', body: '', audience: 'all' });
  const decide = useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: string; note?: string }) => api.post(`/admin/promotions/${id}/decision`, { decision, note, billing: decision === 'approve' ? 'manual' : undefined }),
    onSuccess: () => { toast.success('Updated'); void qc.invalidateQueries({ queryKey: ['admin', 'promotions'] }); },
    onError: (e) => toast.apiError(e),
  });
  const announce = useMutation({
    mutationFn: () => api.post<{ recipients: number }>('/admin/announcements', ann),
    onSuccess: (r) => { toast.success(`Sent to ${r.recipients} users`); setAnn({ title: '', body: '', audience: 'all' }); },
    onError: (e) => toast.apiError(e),
  });
  const run = async (p: Promo, decision: string) => {
    const r = await confirm({ title: `${titleCase(decision)} promotion?`, reason: { placeholder: 'Note to the shop (optional)' }, confirmLabel: titleCase(decision) });
    if (r.confirmed) decide.mutate({ id: p.id, decision, note: r.reason });
  };
  return (
    <Screen title="Promotions & announcements" scroll={false} padded={false}>
      <PaginatedList<Promo>
        key={status ?? 'all'}
        queryKey={['admin', 'promotions', status]}
        fetchPage={(page) => api.page<Promo>('/admin/promotions', { status, page })}
        keyOf={(p) => p.id}
        header={
          <View>
            <SectionHeader title="Send announcement" />
            <TextField label="Title" value={ann.title} onChangeText={(t) => setAnn((a) => ({ ...a, title: t }))} />
            <TextField label="Message" value={ann.body} onChangeText={(t) => setAnn((a) => ({ ...a, body: t }))} multiline />
            <ChoiceChips label="Audience" options={[{ value: 'all', label: 'Everyone' }, { value: 'shop_owners', label: 'Shop owners' }, { value: 'house_heads', label: 'House heads' }]} value={ann.audience} onChange={(v) => v && setAnn((a) => ({ ...a, audience: v }))} />
            <Button title="Send announcement" variant="secondary" disabled={ann.title.length < 3 || ann.body.length < 3} loading={announce.isPending} onPress={async () => (await confirm({ title: 'Send to all recipients?', confirmLabel: 'Send' })).confirmed && announce.mutate()} />
            <SectionHeader title="Promotion requests" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[undefined, 'pending', 'approved', 'rejected', 'cancelled'].map((s) => <Chip key={s ?? 'all'} label={s ?? 'All'} selected={status === s} onPress={() => setStatus(s)} />)}
            </ScrollView>
          </View>
        }
        renderItem={(p) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{titleCase(p.type)}</Text>
              <Badge label={p.status} tone={p.status === 'pending' ? 'warning' : p.status === 'approved' ? 'success' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">Shop {p.shopId.slice(-6)} · {formatDate(p.startsAt)} – {formatDate(p.endsAt)} · billing: {p.billing}</Text>
            {p.keywords.length ? <Text className="text-xs text-ink-600">Keywords: {p.keywords.join(', ')}</Text> : null}
            <Text className="text-xs text-ink-600">Measured: {p.impressions} impressions · {p.clicks} taps</Text>
            <View className="mt-2 flex-row">
              {p.status === 'pending' ? (
                <>
                  <Button title="Approve" size="sm" className="mr-2" onPress={() => void run(p, 'approve')} />
                  <Button title="Reject" size="sm" variant="outline" onPress={() => void run(p, 'reject')} />
                </>
              ) : p.status === 'approved' ? (
                <Button title="Cancel" size="sm" variant="ghost" onPress={() => void run(p, 'cancel')} />
              ) : null}
            </View>
          </Card>
        )}
        empty={{ title: 'No promotions' }}
      />
    </Screen>
  );
}
