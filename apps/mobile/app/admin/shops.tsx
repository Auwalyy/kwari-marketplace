import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ShopSummaryDto, SubscriptionPlan } from '@kkdm/shared';
import { Badge, Button, Card, Chip, PaginatedList, Screen, VerificationBadge, toast, useConfirm } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';

type AdminShop = ShopSummaryDto & { status: string; ownerId: string; ownershipVerificationStatus: string };

/** Shop management: suspend / reactivate, verification status, plans. */
export default function AdminShops() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const params = { q: q || undefined, status };
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) => api.patch(`/admin/shops/${id}`, body),
    onSuccess: () => { toast.success('Shop updated'); void qc.invalidateQueries({ queryKey: ['admin', 'shops'] }); },
    onError: (e) => toast.apiError(e),
  });
  const plan = useMutation({
    mutationFn: ({ id, p }: { id: string; p: SubscriptionPlan }) => api.post(`/admin/shops/${id}/entitlements`, { plan: p }),
    onSuccess: () => toast.success('Plan updated'),
    onError: (e) => toast.apiError(e),
  });
  const act = async (s: AdminShop, body: Record<string, string>, title: string) => {
    const r = await confirm({ title, reason: { placeholder: 'Reason (sent to the owner and audited)', required: true }, confirmLabel: 'Confirm', destructive: body.status === 'suspended' });
    if (r.confirmed && r.reason) update.mutate({ id: s.id, body: { ...body, reason: r.reason } });
  };
  return (
    <Screen title="Shops" scroll={false} padded={false}>
      <View className="px-4 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Name, shop code or number" />
        <ScrollView horizontal className="mt-2" showsHorizontalScrollIndicator={false}>
          {[undefined, 'active', 'pending_membership', 'suspended', 'closed'].map((s) => <Chip key={s ?? 'all'} label={s ? s.replace('_', ' ') : 'All'} selected={status === s} onPress={() => setStatus(s)} />)}
        </ScrollView>
      </View>
      <PaginatedList<AdminShop>
        queryKey={['admin', 'shops', params]}
        fetchPage={(page) => api.page<AdminShop>('/admin/shops', { ...params, page })}
        keyOf={(s) => s.id}
        renderItem={(s) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 font-semibold text-ink-900" onPress={() => router.push(`/shop/${s.slug}`)}>{s.name}</Text>
              <Badge label={s.status.replace('_', ' ')} tone={s.status === 'active' ? 'success' : s.status === 'suspended' ? 'danger' : 'warning'} />
            </View>
            <Text className="text-xs text-ink-500">{s.breadcrumb?.label}</Text>
            <View className="mt-1 flex-row items-center">
              <VerificationBadge status={s.verificationStatus} />
              <Text className="ml-2 text-xs text-ink-500">Ownership: {s.ownershipVerificationStatus}</Text>
            </View>
            <View className="mt-2 flex-row flex-wrap">
              {s.status === 'active' ? <Button title="Suspend" size="sm" variant="outline" className="mb-1 mr-2" onPress={() => void act(s, { status: 'suspended' }, `Suspend ${s.name}?`)} /> : null}
              {s.status === 'suspended' ? <Button title="Reactivate" size="sm" className="mb-1 mr-2" onPress={() => void act(s, { status: 'active' }, `Reactivate ${s.name}?`)} /> : null}
              {s.verificationStatus !== 'verified' ? <Button title="Mark verified" size="sm" variant="secondary" className="mb-1 mr-2" onPress={() => void act(s, { verificationStatus: 'verified' }, 'Mark shop verified?')} /> : <Button title="Remove badge" size="sm" variant="ghost" className="mb-1 mr-2" onPress={() => void act(s, { verificationStatus: 'unverified' }, 'Remove verification badge?')} />}
              <Button title="Premium plan" size="sm" variant="ghost" className="mb-1" onPress={() => plan.mutate({ id: s.id, p: 'premium' })} />
            </View>
          </Card>
        )}
        empty={{ title: 'No shops' }}
      />
    </Screen>
  );
}
