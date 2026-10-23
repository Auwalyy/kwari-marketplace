import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react-native';
import { resellerApplySchema, type ResellerMeDto } from '@kkdm/shared';
import { Button, Card, LoadingView, Notice, Screen, TextField, toast } from '@/components/ui';
import { useDerivedState } from '@/hooks/useDerivedState';
import { colors } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** Apply to become a reseller, see the decision, or edit the reseller profile once approved. */
export default function ResellerApply() {
  const refreshUser = useAuth((s) => s.refreshUser);
  const user = useAuth((s) => s.user);
  const me = useQuery({
    queryKey: ['reseller', 'me'],
    queryFn: async () => {
      try {
        return await api.get<ResellerMeDto>('/resellers/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  const [f, setF] = useDerivedState(
    me.data ?? undefined,
    (r) => ({ businessName: r.businessName, phone: r.phone ?? '', whatsapp: r.whatsapp ?? '', area: r.area ?? '', about: r.about ?? '' }),
    { businessName: user?.fullName ?? '', phone: user?.phone ?? '', whatsapp: '', area: '', about: '' },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const status = me.data?.status;
  const editing = status === 'approved' || status === 'pending';

  const save = useMutation({
    mutationFn: async () => {
      const body = { businessName: f.businessName, phone: f.phone, whatsapp: f.whatsapp || undefined, area: f.area || undefined, about: f.about || undefined };
      const parsed = resellerApplySchema.safeParse(body);
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        throw new Error(parsed.error.issues[0].message);
      }
      setErrors({});
      return editing ? api.patch<ResellerMeDto>('/resellers/me', body) : api.post<ResellerMeDto>('/resellers/apply', body);
    },
    onSuccess: async () => {
      await refreshUser();
      void me.refetch();
      toast.success(editing ? 'Profile saved' : 'Application sent — we’ll notify you when it’s reviewed');
      if (status === 'approved') router.back();
    },
    onError: (e) => toast.apiError(e),
  });

  if (me.isPending) return <Screen title="Reseller"><LoadingView /></Screen>;

  return (
    <Screen
      title={status === 'approved' ? 'My reseller profile' : 'Become a reseller'}
      footer={<Button title={editing ? 'Save' : status === 'rejected' ? 'Apply again' : 'Send application'} size="lg" fullWidth loading={save.isPending} onPress={() => save.mutate()} />}
    >
      {!me.data ? (
        <Card className="mb-4 mt-2">
          <Text className="text-base font-bold text-ink-900">Sell fabric without a shop</Text>
          <Text className="mt-1.5 text-sm leading-5 text-ink-600">
            Approved resellers see special reseller prices from Kantin Kwari shops. Add any of those products to your list at your own price — your customers see your name, you collect from them, and you keep the difference.
          </Text>
        </Card>
      ) : null}
      {status === 'pending' ? (
        <StatusCard icon={<Clock size={22} color={colors.warning} />} title="Application being reviewed" text="An administrator will check your details. You can still edit them below." />
      ) : status === 'approved' ? (
        <StatusCard icon={<CheckCircle2 size={22} color={colors.brand} />} title="You are an approved reseller" text="Customers see these details on your page." />
      ) : status === 'rejected' ? (
        <StatusCard icon={<XCircle size={22} color={colors.danger} />} title="Not approved" text={me.data?.decisionReason ?? 'Update your details and apply again.'} />
      ) : status === 'suspended' ? (
        <Notice tone="danger" title="Reseller account suspended">{me.data?.decisionReason ?? 'Contact support.'}</Notice>
      ) : null}

      <TextField label="Business name" value={f.businessName} onChangeText={(t) => setF((x) => ({ ...x, businessName: t }))} error={errors.businessName} placeholder="The name your customers know" />
      <TextField label="Phone for customers" value={f.phone} onChangeText={(t) => setF((x) => ({ ...x, phone: t }))} keyboardType="phone-pad" error={errors.phone} />
      <TextField label="WhatsApp (optional)" value={f.whatsapp} onChangeText={(t) => setF((x) => ({ ...x, whatsapp: t }))} keyboardType="phone-pad" placeholder="If different from your phone" />
      <TextField label="Where you are (optional)" value={f.area} onChangeText={(t) => setF((x) => ({ ...x, area: t }))} placeholder="e.g. Fagge, Kano" />
      <TextField label="About you (optional)" value={f.about} onChangeText={(t) => setF((x) => ({ ...x, about: t }))} multiline placeholder="What you sell, delivery areas…" />
      <View className="h-2" />
    </Screen>
  );
}

function StatusCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card className="mb-4 mt-2 flex-row">
      {icon}
      <View className="ml-3 flex-1">
        <Text className="text-base font-bold text-ink-900">{title}</Text>
        <Text className="mt-0.5 text-sm text-ink-600">{text}</Text>
      </View>
    </Card>
  );
}
