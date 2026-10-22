import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react-native';
import { MEASUREMENT_UNITS, UNIT_LABELS, type CategoryDto, type MeasurementUnit, type ShopDto } from '@kkdm/shared';
import { Button, ChoiceChips, ErrorState, LoadingView, Screen, SectionHeader, SwitchRow, TextField, pickImages, toast } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type Hours = { day: number; open: string; close: string; closed: boolean };

/** Shop profile editor (owner only — enforced by the API). */
export default function ShopProfile() {
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const qc = useQueryClient();
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<ShopDto>(`/shops/${shopId}`) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const [f, setF] = useDerivedState(
    shop.data,
    (s) => ({ name: s.name, description: s.description ?? '', locationDescription: s.locationDescription ?? '', contactPhone: s.contactPhone ?? '', whatsappPhone: s.whatsappPhone ?? '', contactEmail: s.contactEmail ?? '', categoryIds: s.categoryIds, wholesaleAvailable: s.wholesaleAvailable, enabledUnits: s.enabledUnits, ...s.contactPreferences }),
    { name: '', description: '', locationDescription: '', contactPhone: '', whatsappPhone: '', contactEmail: '', categoryIds: [] as string[], wholesaleAvailable: false, enabledUnits: [] as MeasurementUnit[], chat: true, phone: false, whatsapp: false },
  );
  const [hours, setHours] = useDerivedState<ShopDto, Hours[]>(
    shop.data,
    (s) => (s.businessHours.length ? s.businessHours : [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '18:00', closed: false })).concat([{ day: 0, open: '08:00', close: '18:00', closed: true }])),
    [],
  );

  const done = (s: ShopDto) => {
    qc.setQueryData(['shop', shopId], (old: object | undefined) => ({ ...old, ...s }));
    void qc.invalidateQueries({ queryKey: ['shop'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.patch<ShopDto>(`/shops/${shopId}`, {
        name: f.name,
        description: f.description || undefined,
        locationDescription: f.locationDescription || undefined,
        contactPhone: f.contactPhone || null,
        whatsappPhone: f.whatsappPhone || null,
        contactEmail: f.contactEmail || null,
        categoryIds: f.categoryIds,
        wholesaleAvailable: f.wholesaleAvailable,
        enabledUnits: f.enabledUnits,
        contactPreferences: { chat: f.chat, phone: f.phone, whatsapp: f.whatsapp },
        businessHours: hours,
      }),
    onSuccess: (s) => {
      done(s);
      toast.success('Shop profile saved');
    },
    onError: (e) => toast.apiError(e),
  });
  const upload = useMutation({
    mutationFn: async (kind: 'logo' | 'cover') => {
      const [img] = await pickImages('library', { crop: kind === 'logo' });
      if (!img) return null;
      return api.upload<ShopDto>(`/shops/${shopId}/${kind}`, [{ field: 'image', uri: img.uri, name: img.name, type: img.type }]);
    },
    onSuccess: (s) => s && done(s),
    onError: (e) => toast.apiError(e),
  });

  if (shop.isPending) return <Screen title="Shop profile"><LoadingView /></Screen>;
  if (shop.isError) return <Screen title="Shop profile"><ErrorState error={shop.error} /></Screen>;
  const s = shop.data;
  return (
    <Screen title="Shop profile" footer={<Button title="Save changes" onPress={() => save.mutate()} loading={save.isPending} disabled={f.name.trim().length < 2 || !f.enabledUnits.length} fullWidth />}>
      <Pressable onPress={() => upload.mutate('cover')} className="mb-3 h-32 overflow-hidden rounded-2xl bg-brand-700" accessibilityLabel="Change cover photo">
        {s.coverUrl ? <Image source={{ uri: s.coverUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}
        <View className="absolute bottom-2 right-2 flex-row items-center rounded-full bg-black/50 px-3 py-1">
          <Camera size={14} color={colors.white} />
          <Text className="ml-1 text-xs text-white">Cover</Text>
        </View>
      </Pressable>
      <Pressable onPress={() => upload.mutate('logo')} className="mb-4 flex-row items-center" accessibilityLabel="Change logo">
        <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-brand-50">{s.logoUrl ? <Image source={{ uri: s.logoUrl }} style={{ width: 64, height: 64 }} /> : <Camera size={20} color={colors.brand} />}</View>
        <Text className="ml-3 font-semibold text-brand-700">{upload.isPending ? 'Uploading…' : 'Change logo'}</Text>
      </Pressable>
      <TextField label="Shop name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t }))} />
      <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} multiline />
      <TextField label="How to find the shop" value={f.locationDescription} onChangeText={(t) => setF((x) => ({ ...x, locationDescription: t }))} />
      <ChoiceChips label="Categories" multiple options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={f.categoryIds} onChange={(v: string[]) => setF((x) => ({ ...x, categoryIds: v }))} />
      <ChoiceChips label="Units you sell in" multiple options={MEASUREMENT_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u].plural }))} value={f.enabledUnits} onChange={(v: MeasurementUnit[]) => setF((x) => ({ ...x, enabledUnits: v }))} />
      <SwitchRow label="We sell wholesale" value={f.wholesaleAvailable} onChange={(v) => setF((x) => ({ ...x, wholesaleAvailable: v }))} />

      <SectionHeader title="Contact" />
      <TextField label="Phone" value={f.contactPhone} onChangeText={(t) => setF((x) => ({ ...x, contactPhone: t }))} keyboardType="phone-pad" />
      <TextField label="WhatsApp" value={f.whatsappPhone} onChangeText={(t) => setF((x) => ({ ...x, whatsappPhone: t }))} keyboardType="phone-pad" />
      <TextField label="Email" value={f.contactEmail} onChangeText={(t) => setF((x) => ({ ...x, contactEmail: t }))} keyboardType="email-address" autoCapitalize="none" />
      <SwitchRow label="Customers can chat in the app" value={f.chat} onChange={(v) => setF((x) => ({ ...x, chat: v }))} />
      <SwitchRow label="Show phone number publicly" value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} />
      <SwitchRow label="Show WhatsApp publicly" value={f.whatsapp} onChange={(v) => setF((x) => ({ ...x, whatsapp: v }))} />

      <SectionHeader title="Business hours" />
      {[1, 2, 3, 4, 5, 6, 0].map((day) => {
        const h = hours.find((x) => x.day === day) ?? { day, open: '08:00', close: '18:00', closed: true };
        const setH = (patch: Partial<Hours>) => setHours((hs) => [...hs.filter((x) => x.day !== day), { ...h, ...patch }]);
        return (
          <View key={day} className="mb-2 flex-row items-center">
            <Text className="w-24 text-sm text-ink-800">{DAYS[day]}</Text>
            {h.closed ? (
              <Text className="flex-1 text-sm text-ink-500">Closed</Text>
            ) : (
              <>
                <TextField containerClassName="mb-0 mr-2 flex-1" value={h.open} onChangeText={(t) => setH({ open: t })} placeholder="08:00" />
                <TextField containerClassName="mb-0 flex-1" value={h.close} onChangeText={(t) => setH({ close: t })} placeholder="18:00" />
              </>
            )}
            <Button title={h.closed ? 'Open' : 'Close'} size="sm" variant="ghost" onPress={() => setH({ closed: !h.closed })} />
          </View>
        );
      })}
    </Screen>
  );
}
