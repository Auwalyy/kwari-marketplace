import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react-native';
import { SHOP_PERMISSIONS, SHOP_PERMISSION_LABELS, type ShopPermission, type WorkerInvitationDto } from '@kkdm/shared';
import { Button, Card, ChoiceChips, Notice, Screen, SwitchRow, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Create a worker invitation with specific permissions. The code is shown only once. */
export default function InviteWorker() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const [perms, setPerms] = useState<ShopPermission[]>(['products.manage', 'chats.manage']);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('7');
  const [created, setCreated] = useState<WorkerInvitationDto | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<WorkerInvitationDto>(`/shops/${shopId}/worker-invitations`, { permissions: perms, title: title || undefined, expiresInDays: Number(days), maxUses: 1 }),
    onSuccess: (inv) => {
      setCreated(inv);
      void qc.invalidateQueries({ queryKey: ['worker-invitations', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });

  if (created?.code) {
    return (
      <Screen title="Invitation created">
        <Notice tone="warning" title="Copy this code now">For security it is only shown once. Share it only with the person you are inviting.</Notice>
        <Card className="mb-4 items-center py-6">
          <Text className="text-3xl font-bold tracking-widest text-brand-800">{created.code}</Text>
          <Text className="mt-2 text-xs text-ink-500">Single use · expires {formatDate(created.expiresAt)}</Text>
        </Card>
        <View className="flex-row">
          <Button title="Copy" icon={Copy} variant="outline" className="mr-2 flex-1" onPress={async () => { await Clipboard.setStringAsync(created.code!); toast.success('Copied'); }} />
          <Button title="Share" icon={Share2} className="flex-1" onPress={() => void Share.share({ message: `Join my shop on Kantin Kwari Digital Market. In the app go to Account → Join a shop as a worker and enter: ${created.code}` })} />
        </View>
        <Button title="Done" variant="ghost" className="mt-4" onPress={() => router.back()} fullWidth />
      </Screen>
    );
  }
  return (
    <Screen title="Invite a worker" footer={<Button title="Create invitation" onPress={() => create.mutate()} loading={create.isPending} disabled={!perms.length} fullWidth />}>
      <Notice tone="info">Workers get only the permissions you choose. They can never become owners, change payout details, or change your house membership.</Notice>
      <TextField label="Role title (optional)" value={title} onChangeText={setTitle} placeholder="Sales assistant" />
      {SHOP_PERMISSIONS.map((p) => (
        <SwitchRow key={p} label={SHOP_PERMISSION_LABELS[p]} value={perms.includes(p)} onChange={(v) => setPerms((ps) => (v ? [...ps, p] : ps.filter((x) => x !== p)))} />
      ))}
      <ChoiceChips label="Code expires in" options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} value={days} onChange={(v) => v && setDays(v)} />
    </Screen>
  );
}
