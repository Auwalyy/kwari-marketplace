import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import type { HouseInvitationDto } from '@kkdm/shared';
import { Badge, Button, Card, PaginatedList, Screen, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Manage invitations: status, usage, revoke, regenerate. Full codes are never shown again. */
export default function HouseInvitations() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: ['house-invitations', houseId] });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/houses/${houseId}/invitations/${id}/revoke`), onSuccess: () => { void refresh(); toast.success('Revoked'); }, onError: (e) => toast.apiError(e) });
  const regenerate = useMutation({
    mutationFn: (id: string) => api.post<HouseInvitationDto>(`/houses/${houseId}/invitations/${id}/regenerate`),
    onSuccess: async (inv) => {
      void refresh();
      await confirm({ title: 'New code', message: `${inv.code}\n\nCopy it now — it won’t be shown again. The old code no longer works.`, confirmLabel: 'Done', cancelLabel: 'Close' });
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Invitations" scroll={false} padded={false} footer={<Button title="New invitation" icon={Plus} onPress={() => router.push(`/house-admin/${houseId}/invite`)} fullWidth />}>
      <PaginatedList<HouseInvitationDto>
        queryKey={['house-invitations', houseId]}
        fetchPage={(page) => api.page<HouseInvitationDto>(`/houses/${houseId}/invitations`, { page })}
        keyOf={(i) => i.id}
        renderItem={(i) => (
          <Card className="mb-2">
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{i.codePreview}{i.intendedShopName ? ` · ${i.intendedShopName}` : ''}</Text>
              <Badge label={i.status} tone={i.status === 'active' ? 'success' : i.status === 'exhausted' ? 'info' : 'neutral'} />
            </View>
            <Text className="text-xs text-ink-500">Used {i.usedCount}/{i.maxUses} · created {formatDate(i.createdAt)} · expires {formatDate(i.expiresAt)}</Text>
            {i.note ? <Text className="mt-1 text-xs text-ink-600">{i.note}</Text> : null}
            <View className="mt-2 flex-row">
              {i.status === 'active' ? <Button title="Revoke" size="sm" variant="outline" className="mr-2" onPress={async () => (await confirm({ title: 'Revoke this code?', destructive: true, confirmLabel: 'Revoke' })).confirmed && revoke.mutate(i.id)} /> : null}
              {i.status !== 'exhausted' ? <Button title="Regenerate" size="sm" variant="ghost" onPress={() => regenerate.mutate(i.id)} /> : null}
            </View>
          </Card>
        )}
        empty={{ title: 'No invitations yet' }}
      />
    </Screen>
  );
}
