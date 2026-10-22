import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import type { MarketDto } from '@kkdm/shared';
import { Badge, Button, Card, ErrorState, ListSkeleton, Screen, Sheet, SwitchRow, TextField, toast, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** Markets list; administrators can create markets. */
export default function AdminMarkets() {
  const qc = useQueryClient();
  const isAdmin = useAuth((s) => s.user?.platformRoles.includes('admin'));
  const sheet = useRef<SheetHandle>(null);
  const [f, setF] = useState({ name: '', slug: '', city: 'Kano', region: 'Kano', description: '', usesSections: true });
  const q = useQuery({ queryKey: ['markets'], queryFn: () => api.page<MarketDto>('/markets', { limit: 50 }) });
  const create = useMutation({
    mutationFn: () => api.post('/markets', { ...f, description: f.description || undefined, country: 'NG' }),
    onSuccess: () => {
      toast.success('Market created');
      sheet.current?.close();
      void qc.invalidateQueries({ queryKey: ['markets'] });
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Markets" onRefresh={() => void q.refetch()} refreshing={q.isRefetching} footer={isAdmin ? <Button title="Create market" icon={Plus} onPress={() => sheet.current?.open()} fullWidth /> : undefined}>
      {q.isPending ? <ListSkeleton rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data?.items.map((m) => (
        <Card key={m.id} className="mb-2" onPress={() => router.push(`/admin/market/${m.id}`)}>
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink-900">{m.name}</Text>
            <Badge label={m.status} tone={m.status === 'active' ? 'success' : 'neutral'} />
          </View>
          <Text className="text-xs text-ink-500">{m.city}, {m.region} · {m.stats?.sections ?? 0} sections · {m.stats?.houses ?? 0} houses · {m.stats?.shops ?? 0} shops</Text>
        </Card>
      ))}
      <Sheet ref={sheet} title="New market" footer={<Button title="Create" onPress={() => create.mutate()} loading={create.isPending} disabled={f.name.length < 2 || f.slug.length < 2} fullWidth />}>
        <TextField label="Name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t, slug: x.slug || t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))} />
        <TextField label="Slug" value={f.slug} onChangeText={(t) => setF((x) => ({ ...x, slug: t.toLowerCase() }))} autoCapitalize="none" />
        <TextField label="City" value={f.city} onChangeText={(t) => setF((x) => ({ ...x, city: t }))} />
        <TextField label="State / region" value={f.region} onChangeText={(t) => setF((x) => ({ ...x, region: t }))} />
        <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} multiline />
        <SwitchRow label="Organised into sections / blocks" value={f.usesSections} onChange={(v) => setF((x) => ({ ...x, usesSections: v }))} />
      </Sheet>
    </Screen>
  );
}
