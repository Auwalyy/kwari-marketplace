import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react-native';
import { shopRegistrationSchema, type CategoryDto, type LocationBreadcrumb, type ShopDto } from '@kkdm/shared';
import { Body, Button, Card, ChoiceChips, ErrorState, Heading, LocationBreadcrumbView, Notice, Screen, TextField, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface Preview {
  house: { id: string; houseNumber: string; name: string; breadcrumb: LocationBreadcrumb | null };
  expiresAt: string;
  remainingUses: number;
  intendedShopName: string | null;
  intendedShopNumber: string | null;
  autoApprove: boolean;
}

/** Register a physical shop with a house invitation code from the house head. */
export default function RegisterShop() {
  const refreshUser = useAuth((s) => s.refreshUser);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState({ name: '', shopNumber: '', description: '', locationDescription: '', contactPhone: '', categoryIds: [] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });

  const check = useMutation({
    mutationFn: () => api.post<Preview>('/invitations/house/preview', { code }),
    onSuccess: (p) => {
      setPreview(p);
      setForm((f) => ({ ...f, name: f.name || p.intendedShopName || '', shopNumber: f.shopNumber || p.intendedShopNumber || '' }));
    },
  });
  const register = useMutation({
    mutationFn: (body: unknown) => api.post<{ shop: ShopDto }>('/shops/register', body),
    onSuccess: async (res) => {
      await refreshUser();
      toast.success(res.shop.status === 'active' ? 'Shop registered and approved' : 'Registration sent to the house head');
      router.replace(res.shop.status === 'active' ? `/seller/${res.shop.id}` : `/seller/${res.shop.id}/membership`);
    },
    onError: (e) => toast.apiError(e),
  });

  const submit = () => {
    const parsed = shopRegistrationSchema.safeParse({
      invitationCode: code,
      name: form.name,
      shopNumber: form.shopNumber,
      description: form.description || undefined,
      locationDescription: form.locationDescription || undefined,
      contactPhone: form.contactPhone || undefined,
      categoryIds: form.categoryIds,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    register.mutate(parsed.data);
  };

  return (
    <Screen title="Register your shop" footer={preview ? <Button title="Submit registration" onPress={submit} loading={register.isPending} fullWidth size="lg" /> : undefined}>
      {!preview ? (
        <>
          <Notice tone="info" title="You need an invitation code">Ask the head of the house where your shop is located. Each code links your shop to that house; the house head then approves your registration. A code does not by itself verify ownership.</Notice>
          {check.error ? <View className="mb-3"><ErrorState error={check.error} compact /></View> : null}
          <TextField label="House invitation code" icon={KeyRound} value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" placeholder="ABCD-EFGH-JK" />
          <Button title="Check code" onPress={() => check.mutate()} loading={check.isPending} disabled={code.replace(/[\s-]/g, '').length < 8} fullWidth />
        </>
      ) : (
        <>
          <Card className="mb-4 border-brand-300 bg-brand-50">
            <Heading>House {preview.house.houseNumber}</Heading>
            <Text className="text-sm text-ink-700">{preview.house.name}</Text>
            <View className="mt-1">
              <LocationBreadcrumbView breadcrumb={preview.house.breadcrumb} />
            </View>
            <Text className="mt-2 text-xs text-ink-500">Code valid until {formatDate(preview.expiresAt)} · {preview.autoApprove ? 'This house approves registrations automatically.' : 'The house head will review your registration.'}</Text>
            <Button title="Use a different code" variant="ghost" size="sm" className="mt-1 self-start" onPress={() => setPreview(null)} />
          </Card>
          <TextField label="Shop name" value={form.name} onChangeText={(t) => setForm((f) => ({ ...f, name: t }))} error={errors.name} />
          <TextField label="Shop number in the house" value={form.shopNumber} onChangeText={(t) => setForm((f) => ({ ...f, shopNumber: t.toUpperCase() }))} placeholder="e.g. 015" error={errors.shopNumber} />
          <TextField label="Where exactly is the shop? (optional)" value={form.locationDescription} onChangeText={(t) => setForm((f) => ({ ...f, locationDescription: t }))} placeholder="First floor, left of the stairs" />
          <TextField label="Shop phone (optional)" value={form.contactPhone} onChangeText={(t) => setForm((f) => ({ ...f, contactPhone: t }))} keyboardType="phone-pad" error={errors.contactPhone} />
          <TextField label="What do you sell? (optional)" value={form.description} onChangeText={(t) => setForm((f) => ({ ...f, description: t }))} multiline />
          <ChoiceChips label="Categories" multiple options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={form.categoryIds} onChange={(v: string[]) => setForm((f) => ({ ...f, categoryIds: v }))} />
          <Body className="text-xs">After approval you can add products, set pickup and delivery options, and invite workers.</Body>
        </>
      )}
    </Screen>
  );
}
