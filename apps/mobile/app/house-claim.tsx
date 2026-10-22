import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { HouseDto } from '@kkdm/shared';
import { Button, Card, Notice, Screen, SectionHeader, TextField, toast } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';

/** A house head claims a house that has no head; an administrator reviews the evidence. */
export default function HouseClaim() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<HouseDto | null>(null);
  const [evidence, setEvidence] = useState('');
  const houses = useQuery({ queryKey: ['houses', 'claim', q], queryFn: () => api.page<HouseDto>('/houses', { q, limit: 20 }), enabled: q.length > 0 });
  const claim = useMutation({
    mutationFn: () => api.post('/houses/claims', { houseId: selected!.id, evidence }),
    onSuccess: () => {
      toast.success('Claim submitted for review');
      router.back();
    },
    onError: (e) => toast.apiError(e),
  });
  return (
    <Screen title="Claim a house" footer={selected ? <Button title="Submit claim" onPress={() => claim.mutate()} loading={claim.isPending} disabled={evidence.trim().length < 10} fullWidth /> : undefined}>
      <Notice tone="info">Use this only if you are the recognised head of a house that has no head on Kantin Kwari yet. Administrators verify every claim before granting access.</Notice>
      <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="House number, e.g. KW-024" />
      <View className="mt-3">
        {houses.data?.items.map((h) => (
          <Pressable key={h.id} onPress={() => setSelected(h)} className={`mb-2 rounded-2xl border p-3 ${selected?.id === h.id ? 'border-brand-700 bg-brand-50' : 'border-line bg-white'}`} disabled={h.hasHead}>
            <Text className="font-semibold text-ink-900">House {h.houseNumber} · {h.name}</Text>
            <Text className="text-xs text-ink-500">{h.breadcrumb.label}{h.hasHead ? ' · already has a head' : ''}</Text>
          </Pressable>
        ))}
      </View>
      {selected ? (
        <>
          <SectionHeader title={`Claim House ${selected.houseNumber}`} />
          <Card className="mb-3">
            <Text className="text-sm text-ink-700">Describe your role and how an administrator can confirm it (property documents, market association letter, contacts).</Text>
          </Card>
          <TextField label="Evidence" multiline value={evidence} onChangeText={setEvidence} />
        </>
      ) : null}
    </Screen>
  );
}
