import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react-native';
import { SHOP_PERMISSION_LABELS, type LocationBreadcrumb, type ShopPermission } from '@kkdm/shared';
import { Button, Card, ErrorState, Heading, LocationBreadcrumbView, Notice, Screen, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

interface Preview {
  shop: { id: string; name: string; slug: string; breadcrumb: LocationBreadcrumb | null };
  permissions: ShopPermission[];
  title: string | null;
  expiresAt: string;
}

/** Join a shop as a worker using the owner's invitation code. Only the listed permissions are granted. */
export default function JoinShop() {
  const refreshUser = useAuth((s) => s.refreshUser);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const check = useMutation({ mutationFn: () => api.post<Preview>('/invitations/worker/preview', { code }), onSuccess: setPreview });
  const join = useMutation({
    mutationFn: () => api.post<{ shopId: string }>('/invitations/worker/redeem', { code }),
    onSuccess: async (r) => {
      await refreshUser();
      toast.success('You joined the shop');
      router.replace(`/seller/${r.shopId}`);
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Join a shop">
      {!preview ? (
        <>
          <Notice tone="info">Enter the worker invitation code the shop owner gave you.</Notice>
          {check.error ? <View className="mb-3"><ErrorState error={check.error} compact /></View> : null}
          <TextField label="Worker invitation code" icon={KeyRound} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" />
          <Button title="Check code" onPress={() => check.mutate()} loading={check.isPending} disabled={code.replace(/[\s-]/g, '').length < 8} fullWidth />
        </>
      ) : (
        <>
          <Card className="mb-4">
            <Heading>{preview.shop.name}</Heading>
            <LocationBreadcrumbView breadcrumb={preview.shop.breadcrumb} />
            {preview.title ? <Text className="mt-2 text-sm text-ink-700">Role: {preview.title}</Text> : null}
            <Text className="mb-1 mt-3 text-sm font-semibold text-ink-700">You will be able to:</Text>
            {preview.permissions.map((p) => (
              <Text key={p} className="text-sm text-ink-700">• {SHOP_PERMISSION_LABELS[p]}</Text>
            ))}
            <Text className="mt-3 text-xs text-ink-500">Workers never get ownership, payout or house-membership rights. The owner can change or remove your access at any time.</Text>
          </Card>
          <Button title="Join shop" onPress={() => join.mutate()} loading={join.isPending} fullWidth size="lg" />
          <Button title="Cancel" variant="ghost" className="mt-2" onPress={() => setPreview(null)} fullWidth />
        </>
      )}
    </Screen>
  );
}
