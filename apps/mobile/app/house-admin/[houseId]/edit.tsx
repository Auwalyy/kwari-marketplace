import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HouseDto } from '@kkdm/shared';
import { Badge, Button, Card, Divider, ErrorState, LoadingView, Notice, Screen, SectionHeader, TextField, toast, useConfirm } from '@/components/ui';
import { api } from '@/lib/api';

interface Staff { id: string; userId: string; fullName: string; role: 'head' | 'assistant' }
type MyHouse = HouseDto & { role: string; allowAssistants: boolean };

/** House profile editor and (if enabled by an administrator) assistants. */
export default function EditHouse() {
  const { houseId } = useLocalSearchParams<{ houseId: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const house = useQuery({ queryKey: ['house', houseId], queryFn: () => api.get<HouseDto>(`/houses/${houseId}`) });
  const mine = useQuery({ queryKey: ['houses', 'mine'], queryFn: () => api.get<MyHouse[]>('/houses/mine/list') });
  const staff = useQuery({ queryKey: ['house-staff', houseId], queryFn: () => api.get<Staff[]>(`/houses/${houseId}/staff`) });
  const [f, setF] = useState({ name: '', description: '', addressDescription: '', contactPhone: '', contactEmail: '', lat: '', lng: '' });
  const [assistant, setAssistant] = useState('');
  useEffect(() => {
    const h = house.data;
    if (h) setF({ name: h.name, description: h.description ?? '', addressDescription: h.addressDescription, contactPhone: h.contactPhone ?? '', contactEmail: h.contactEmail ?? '', lat: h.location ? String(h.location.lat) : '', lng: h.location ? String(h.location.lng) : '' });
  }, [house.data]);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/houses/${houseId}`, {
        name: f.name,
        description: f.description || undefined,
        addressDescription: f.addressDescription,
        contactPhone: f.contactPhone || undefined,
        contactEmail: f.contactEmail || undefined,
        location: f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : undefined,
      }),
    onSuccess: () => {
      toast.success('House profile saved');
      void qc.invalidateQueries({ queryKey: ['house', houseId] });
    },
    onError: (e) => toast.apiError(e),
  });
  const addAssistant = useMutation({ mutationFn: () => api.post(`/houses/${houseId}/assistants`, { identifier: assistant }), onSuccess: () => { setAssistant(''); void staff.refetch(); }, onError: (e) => toast.apiError(e) });
  const removeAssistant = useMutation({ mutationFn: (userId: string) => api.del(`/houses/${houseId}/assistants/${userId}`), onSuccess: () => void staff.refetch(), onError: (e) => toast.apiError(e) });

  if (house.isPending) return <Screen title="House profile"><LoadingView /></Screen>;
  if (house.isError) return <Screen title="House profile"><ErrorState error={house.error} /></Screen>;
  const me = mine.data?.find((h) => h.id === houseId);
  return (
    <Screen title="House profile" footer={<Button title="Save profile" onPress={() => save.mutate()} loading={save.isPending} fullWidth />}>
      <Text className="mb-3 text-sm text-ink-500">House number {house.data.houseNumber} and its section are set by market administrators.</Text>
      <TextField label="House name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t }))} />
      <TextField label="Where is the house?" value={f.addressDescription} onChangeText={(t) => setF((x) => ({ ...x, addressDescription: t }))} multiline />
      <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} multiline />
      <TextField label="Contact phone" value={f.contactPhone} onChangeText={(t) => setF((x) => ({ ...x, contactPhone: t }))} keyboardType="phone-pad" />
      <TextField label="Contact email" value={f.contactEmail} onChangeText={(t) => setF((x) => ({ ...x, contactEmail: t }))} keyboardType="email-address" autoCapitalize="none" />
      <View className="flex-row">
        <TextField containerClassName="mr-2 flex-1" label="Latitude (optional)" keyboardType="numeric" value={f.lat} onChangeText={(t) => setF((x) => ({ ...x, lat: t }))} />
        <TextField containerClassName="flex-1" label="Longitude (optional)" keyboardType="numeric" value={f.lng} onChangeText={(t) => setF((x) => ({ ...x, lng: t }))} />
      </View>

      <SectionHeader title="House staff" />
      <Card>
        {staff.data?.map((s, i) => (
          <View key={s.id}>
            {i ? <Divider /> : null}
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">{s.fullName}</Text>
              {s.role === 'head' ? (
                <Badge label="Head" tone="info" />
              ) : me?.role === 'head' ? (
                <Button title="Remove" size="sm" variant="ghost" onPress={async () => (await confirm({ title: `Remove ${s.fullName}?`, destructive: true, confirmLabel: 'Remove' })).confirmed && removeAssistant.mutate(s.userId)} />
              ) : (
                <Badge label="Assistant" />
              )}
            </View>
          </View>
        ))}
      </Card>
      {me?.role === 'head' ? (
        me.allowAssistants ? (
          <View className="mt-3">
            <TextField label="Add assistant (email or phone of an existing account)" value={assistant} onChangeText={setAssistant} autoCapitalize="none" />
            <Button title="Add assistant" variant="outline" onPress={() => addAssistant.mutate()} loading={addAssistant.isPending} disabled={assistant.length < 3} />
          </View>
        ) : (
          <View className="mt-3">
            <Notice tone="info">Assistants are not enabled for this house. An administrator can enable them on request.</Notice>
          </View>
        )
      ) : null}
    </Screen>
  );
}
