import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import type { MarketDto, SectionDto } from '@kkdm/shared';
import { Badge, Button, Card, Chip, ChoiceChips, PaginatedList, Screen, Sheet, TextField, toast, type SheetHandle } from '@/components/ui';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';

interface AdminHouse {
  id: string;
  marketId: string;
  sectionId: string | null;
  houseNumber: string;
  name: string;
  status: string;
  verificationStatus: string;
  headVerificationStatus: string;
  autoApproveMemberships: boolean;
  allowAssistants: boolean;
  shopCount: number;
  head: { id: string; fullName?: string; phone?: string } | null;
}

/** Houses (scoped for market managers), creation and quick filters. */
export default function AdminHouses() {
  const qc = useQueryClient();
  const sheet = useRef<SheetHandle>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [headless, setHeadless] = useState(false);
  const markets = useQuery({ queryKey: ['markets'], queryFn: () => api.page<MarketDto>('/markets', { limit: 50 }) });
  const [f, setF] = useState({ marketId: '', sectionId: '', houseNumber: '', name: '', addressDescription: '' });
  const sections = useQuery({ queryKey: ['sections', f.marketId], queryFn: () => api.get<SectionDto[]>(`/markets/${f.marketId}/sections`), enabled: !!f.marketId });
  const create = useMutation({
    mutationFn: () => api.post('/houses', { marketId: f.marketId, sectionId: f.sectionId || null, houseNumber: f.houseNumber, name: f.name, addressDescription: f.addressDescription }),
    onSuccess: () => {
      toast.success('House created');
      sheet.current?.close();
      setF((x) => ({ ...x, houseNumber: '', name: '', addressDescription: '' }));
      void qc.invalidateQueries({ queryKey: ['admin', 'houses'] });
    },
    onError: (e) => toast.apiError(e),
  });
  const params = { q: q || undefined, headless: headless || undefined };
  const market = markets.data?.items.find((m) => m.id === f.marketId);
  return (
    <Screen title="Houses" scroll={false} padded={false} footer={<Button title="Add house" icon={Plus} onPress={() => sheet.current?.open()} fullWidth />}>
      <View className="px-4 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="House number" />
        <View className="mt-2 flex-row">
          <Chip label="Without a head" selected={headless} onPress={() => setHeadless((v) => !v)} />
        </View>
      </View>
      <PaginatedList<AdminHouse>
        queryKey={['admin', 'houses', params]}
        fetchPage={(page) => api.page<AdminHouse>('/admin/houses', { ...params, page })}
        keyOf={(h) => h.id}
        renderItem={(h) => (
          <Card className="mb-2" onPress={() => router.push(`/admin/house/${h.id}`)}>
            <View className="flex-row items-center justify-between">
              <Text className="font-semibold text-ink-900">House {h.houseNumber} · {h.name}</Text>
              {h.status !== 'active' ? <Badge label={h.status} /> : null}
            </View>
            <Text className="text-xs text-ink-500">Head: {h.head?.fullName ?? 'none'} ({h.headVerificationStatus}) · {h.shopCount} shops{h.autoApproveMemberships ? ' · auto-approve' : ''}</Text>
          </Card>
        )}
        empty={{ title: 'No houses found' }}
      />
      <Sheet ref={sheet} title="New house" footer={<Button title="Create house" onPress={() => create.mutate()} loading={create.isPending} disabled={!f.marketId || !f.houseNumber || !f.name || f.addressDescription.length < 3} fullWidth />}>
        <ChoiceChips label="Market" options={(markets.data?.items ?? []).map((m) => ({ value: m.id, label: m.name }))} value={f.marketId} onChange={(v) => setF((x) => ({ ...x, marketId: v ?? '', sectionId: '' }))} />
        {market?.usesSections ? <ChoiceChips label="Section (optional)" options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} value={f.sectionId} onChange={(v) => setF((x) => ({ ...x, sectionId: v ?? '' }))} /> : null}
        <TextField label="House number" value={f.houseNumber} onChangeText={(t) => setF((x) => ({ ...x, houseNumber: t.toUpperCase() }))} placeholder="KW-024" />
        <TextField label="Name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t }))} />
        <TextField label="Address / location description" value={f.addressDescription} onChangeText={(t) => setF((x) => ({ ...x, addressDescription: t }))} multiline />
      </Sheet>
    </Screen>
  );
}
