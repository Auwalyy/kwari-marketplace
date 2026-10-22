import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SHOP_PERMISSIONS, SHOP_PERMISSION_LABELS, type ShopPermission } from '@kkdm/shared';
import { Button, ErrorState, Heading, LoadingView, Notice, Screen, SwitchRow, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';

interface Worker { membershipId: string; fullName: string; title?: string; role: string; permissions: ShopPermission[] }

/** Edit one worker's permissions (owner only). Changes apply immediately on the server. */
export default function WorkerPermissions() {
  const { shopId, membershipId } = useLocalSearchParams<{ shopId: string; membershipId: string }>();
  const qc = useQueryClient();
  const workers = useQuery({ queryKey: ['workers', shopId], queryFn: () => api.get<Worker[]>(`/shops/${shopId}/workers`) });
  const w = workers.data?.find((x) => x.membershipId === membershipId);
  const [perms, setPerms] = useState<ShopPermission[]>([]);
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (w) {
      setPerms(w.permissions);
      setTitle(w.title ?? '');
    }
  }, [w]);
  const save = useMutation({
    mutationFn: () => api.patch(`/shops/${shopId}/workers/${membershipId}`, { permissions: perms, title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workers', shopId] });
      toast.success('Permissions updated');
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  if (workers.isPending) return <Screen title="Permissions"><LoadingView /></Screen>;
  if (workers.isError || !w) return <Screen title="Permissions"><ErrorState error={workers.error ?? new Error('Worker not found')} /></Screen>;
  return (
    <Screen title="Permissions" subtitle={w.fullName} footer={<Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={!perms.length} fullWidth />}>
      <Heading className="mb-2">{w.fullName}</Heading>
      <TextField label="Role title" value={title} onChangeText={setTitle} />
      {SHOP_PERMISSIONS.map((p) => (
        <SwitchRow key={p} label={SHOP_PERMISSION_LABELS[p]} value={perms.includes(p)} onChange={(v) => setPerms((ps) => (v ? [...ps, p] : ps.filter((x) => x !== p)))} />
      ))}
      <Notice tone="info">At least one permission is required. To remove access entirely, remove the worker from the Workers screen.</Notice>
    </Screen>
  );
}
