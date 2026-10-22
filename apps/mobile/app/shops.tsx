import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react-native';
import type { CategoryDto, ShopSummaryDto } from '@kkdm/shared';
import { Button, ChoiceChips, IconButton, PaginatedList, Screen, Sheet, SwitchRow, type SheetHandle } from '@/components/ui';
import { SearchBar, ShopCard } from '@/components/cards';
import { api } from '@/lib/api';

interface Filters {
  categoryId?: string;
  verifiedOnly?: boolean;
  wholesaleOnly?: boolean;
  hasProducts?: boolean;
  sort: 'rating' | 'newest' | 'name' | 'products';
}

/** Public shop directory with filters for location, category, availability and verification. */
export default function Shops() {
  const params = useLocalSearchParams<{ houseId?: string; sectionId?: string; marketId?: string; wholesaleOnly?: string; title?: string }>();
  const sheet = useRef<SheetHandle>(null);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>({ sort: 'rating', wholesaleOnly: params.wholesaleOnly === '1' });
  const [draft, setDraft] = useState<Filters>(filters);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const query = { q: q || undefined, houseId: params.houseId, sectionId: params.sectionId, marketId: params.marketId, ...filters };

  return (
    <Screen title={params.title ?? 'Shops'} scroll={false} padded={false} right={<IconButton icon={SlidersHorizontal} label="Filters" onPress={() => { setDraft(filters); sheet.current?.open(); }} />}>
      <View className="px-4 pb-2 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="Shop name, code or house number" />
      </View>
      <PaginatedList<ShopSummaryDto>
        queryKey={['shops', query]}
        fetchPage={(page) => api.page<ShopSummaryDto>('/shops', { ...query, page })}
        keyOf={(s) => s.id}
        renderItem={(s) => <ShopCard shop={s} />}
        empty={{ title: 'No shops found', message: 'Try a different name or remove filters.' }}
      />
      <Sheet
        ref={sheet}
        title="Filter shops"
        footer={<Button title="Apply" onPress={() => { setFilters(draft); sheet.current?.close(); }} fullWidth />}
      >
        <ChoiceChips label="Sort" options={[{ value: 'rating', label: 'Top rated' }, { value: 'products', label: 'Most products' }, { value: 'newest', label: 'Newest' }, { value: 'name', label: 'Name' }]} value={draft.sort} onChange={(v) => setDraft((d) => ({ ...d, sort: v ?? 'rating' }))} />
        <ChoiceChips label="Category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={draft.categoryId} onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))} />
        <SwitchRow label="Verified shops only" value={!!draft.verifiedOnly} onChange={(v) => setDraft((d) => ({ ...d, verifiedOnly: v }))} />
        <SwitchRow label="Offers wholesale" value={!!draft.wholesaleOnly} onChange={(v) => setDraft((d) => ({ ...d, wholesaleOnly: v }))} />
        <SwitchRow label="Has products available" value={!!draft.hasProducts} onChange={(v) => setDraft((d) => ({ ...d, hasProducts: v }))} />
      </Sheet>
    </Screen>
  );
}
