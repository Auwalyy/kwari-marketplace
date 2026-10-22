import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import type { MarketDto, SectionDto } from '@kkdm/shared';
import { Button, Card, ErrorState, LoadingView, Screen, SectionHeader, Sheet, SwitchRow, TextField, toast, useConfirm, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';

/** Edit a market and manage its sections / blocks. */
export default function AdminMarket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const sheet = useRef<SheetHandle>(null);
  const market = useQuery({ queryKey: ['market', id], queryFn: () => api.get<MarketDto>(`/markets/${id}`) });
  const sections = useQuery({ queryKey: ['sections', id], queryFn: () => api.get<SectionDto[]>(`/markets/${id}/sections`) });
  const [f, setF] = useDerivedState(
    market.data,
    (m) => ({ name: m.name, description: m.description ?? '', city: m.city, region: m.region, usesSections: m.usesSections, active: m.status === 'active', lat: m.location ? String(m.location.lat) : '', lng: m.location ? String(m.location.lng) : '' }),
    { name: '', description: '', city: '', region: '', usesSections: true, active: true, lat: '', lng: '' },
  );
  const [section, setSection] = useState<{ id?: string; name: string; code: string; locationDescription: string }>({ name: '', code: '', locationDescription: '' });

  const save = useMutation({
    mutationFn: () => api.patch(`/markets/${id}`, { name: f.name, description: f.description || undefined, city: f.city, region: f.region, usesSections: f.usesSections, status: f.active ? 'active' : 'inactive', location: f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : undefined }),
    onSuccess: () => { toast.success('Saved'); void qc.invalidateQueries({ queryKey: ['markets'] }); void market.refetch(); },
    onError: (e) => toast.apiError(e),
  });
  const saveSection = useMutation({
    mutationFn: () => (section.id ? api.patch(`/sections/${section.id}`, { name: section.name, code: section.code, locationDescription: section.locationDescription || undefined }) : api.post(`/markets/${id}/sections`, { name: section.name, code: section.code, locationDescription: section.locationDescription || undefined })),
    onSuccess: () => { sheet.current?.close(); void sections.refetch(); toast.success('Section saved'); },
    onError: (e) => toast.apiError(e),
  });
  const deactivate = useMutation({ mutationFn: (sid: string) => api.del(`/sections/${sid}`), onSuccess: () => void sections.refetch(), onError: (e) => toast.apiError(e) });

  if (market.isPending) return <Screen title="Market"><LoadingView /></Screen>;
  if (market.isError) return <Screen title="Market"><ErrorState error={market.error} /></Screen>;
  return (
    <Screen title={market.data.name}>
      <TextField label="Name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t }))} />
      <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} multiline />
      <View className="flex-row">
        <TextField containerClassName="mr-2 flex-1" label="City" value={f.city} onChangeText={(t) => setF((x) => ({ ...x, city: t }))} />
        <TextField containerClassName="flex-1" label="Region" value={f.region} onChangeText={(t) => setF((x) => ({ ...x, region: t }))} />
      </View>
      <View className="flex-row">
        <TextField containerClassName="mr-2 flex-1" label="Latitude" keyboardType="numeric" value={f.lat} onChangeText={(t) => setF((x) => ({ ...x, lat: t }))} />
        <TextField containerClassName="flex-1" label="Longitude" keyboardType="numeric" value={f.lng} onChangeText={(t) => setF((x) => ({ ...x, lng: t }))} />
      </View>
      <SwitchRow label="Uses sections / blocks" value={f.usesSections} onChange={(v) => setF((x) => ({ ...x, usesSections: v }))} />
      <SwitchRow label="Active" value={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} />
      <Button title="Save market" onPress={() => save.mutate()} loading={save.isPending} />

      {f.usesSections ? (
        <>
          <SectionHeader title="Sections" action="Add" onAction={() => { setSection({ name: '', code: '', locationDescription: '' }); sheet.current?.open(); }} />
          {sections.data?.map((s) => (
            <Card key={s.id} className="mb-2">
              <Text className="font-semibold text-ink-900">{s.code} · {s.name}</Text>
              <Text className="text-xs text-ink-500">{s.houseCount ?? 0} houses</Text>
              <View className="mt-2 flex-row">
                <Button title="Edit" size="sm" variant="outline" className="mr-2" onPress={() => { setSection({ id: s.id, name: s.name, code: s.code, locationDescription: s.locationDescription ?? '' }); sheet.current?.open(); }} />
                <Button title="Deactivate" size="sm" variant="ghost" onPress={async () => (await confirm({ title: `Deactivate section ${s.code}?`, message: 'Only possible when it has no active houses.', confirmLabel: 'Deactivate' })).confirmed && deactivate.mutate(s.id)} />
              </View>
            </Card>
          ))}
          {!sections.data?.length ? <Button title="Add first section" icon={Plus} variant="outline" onPress={() => sheet.current?.open()} /> : null}
        </>
      ) : null}
      <Sheet ref={sheet} title={section.id ? 'Edit section' : 'New section'} footer={<Button title="Save section" onPress={() => saveSection.mutate()} loading={saveSection.isPending} disabled={!section.name || !section.code} fullWidth />}>
        <TextField label="Code" value={section.code} onChangeText={(t) => setSection((x) => ({ ...x, code: t.toUpperCase() }))} placeholder="B" />
        <TextField label="Name" value={section.name} onChangeText={(t) => setSection((x) => ({ ...x, name: t }))} placeholder="Section B — Lace Row" />
        <TextField label="Location description" value={section.locationDescription} onChangeText={(t) => setSection((x) => ({ ...x, locationDescription: t }))} multiline />
      </Sheet>
    </Screen>
  );
}
