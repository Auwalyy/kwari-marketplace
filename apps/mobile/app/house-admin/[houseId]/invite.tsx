import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react-native';
import type { HouseInvitationDto } from '@kkdm/shared';
import { Button, Card, ChoiceChips, Notice, Screen, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Create a shop-registration invitation (verified house heads only — enforced by the API). */
export default function InviteShop() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  const qc = useQueryClient();
  const [days, setDays] = useState('7');
  const [uses, setUses] = useState('1');
  const [shopName, setShopName] = useState('');
  const [shopNumber, setShopNumber] = useState('');
  const [note, setNote] = useState('');
  const [created, setCreated] = useState<HouseInvitationDto | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<HouseInvitationDto>(`/houses/${houseId}/invitations`, { expiresInDays: Number(days), maxUses: Number(uses), intendedShopName: shopName || undefined, intendedShopNumber: shopNumber || undefined, note: note || undefined }),
    onSuccess: (inv) => {
      setCreated(inv);
      void qc.invalidateQueries({ queryKey: ['house-invitations', houseId] });
    },
    onError: (e) => toast.apiError(e),
  });
  if (created?.code) {
    return (
      <Screen title="Invitation created">
        <Notice tone="warning" title="Copy this code now">It is shown only once. Give it directly to the shop owner.</Notice>
        <Card className="mb-4 items-center py-6">
          <Text className="text-3xl font-bold tracking-widest text-brand-800">{created.code}</Text>
          <Text className="mt-2 text-xs text-ink-500">{created.maxUses} use(s) · expires {formatDate(created.expiresAt)}</Text>
        </Card>
        <View className="flex-row">
          <Button title="Copy" icon={Copy} variant="outline" className="mr-2 flex-1" onPress={async () => { await Clipboard.setStringAsync(created.code!); toast.success('Copied'); }} />
          <Button title="Share" icon={Share2} className="flex-1" onPress={() => void Share.share({ message: `Register your shop on Kantin Kwari Digital Market: Account → Register a physical shop, then enter code ${created.code}` })} />
        </View>
        <Button title="Done" variant="ghost" className="mt-4" onPress={() => router.back()} fullWidth />
      </Screen>
    );
  }
  return (
    <Screen title="Create shop invitation" footer={<Button title="Create code" onPress={() => create.mutate()} loading={create.isPending} fullWidth />}>
      <Notice tone="info">Shops that use this code are linked to your house and wait for your approval (unless an administrator enabled automatic approval for your house).</Notice>
      <ChoiceChips label="Expires after" options={[{ value: '1', label: '1 day' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} value={days} onChange={(v) => v && setDays(v)} />
      <ChoiceChips label="Number of shops that can use it" options={[{ value: '1', label: '1' }, { value: '5', label: '5' }, { value: '20', label: '20' }]} value={uses} onChange={(v) => v && setUses(v)} />
      <TextField label="Intended shop name (optional)" value={shopName} onChangeText={setShopName} />
      <TextField label="Intended shop number (optional)" value={shopNumber} onChangeText={(t) => setShopNumber(t.toUpperCase())} />
      <TextField label="Private note (optional)" value={note} onChangeText={setNote} />
    </Screen>
  );
}
