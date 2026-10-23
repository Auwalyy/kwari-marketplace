import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Clock, SlidersHorizontal, X } from 'lucide-react-native';
import type { CategoryDto, ProductSummaryDto } from '@kkdm/shared';
import { Button, Chip, ChoiceChips, IconButton, PaginatedList, ProductGridSkeleton, Sheet, SwitchRow, TextField, type SheetHandle } from '@/components/ui';
import { ProductCard, SearchBar } from '@/components/cards';
import { ResellerStrip } from '@/components/reseller';
import { colors } from '@/constants/theme';
import { useFavourites } from '@/hooks';
import { api } from '@/lib/api';
import { nairaInputToKobo } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface Filters {
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  wholesaleOnly?: boolean;
  inStockOnly?: boolean;
  verifiedOnly?: boolean;
  colour?: string;
  sort: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'rating';
}

const SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
] as const;
const COLOURS = ['red', 'blue', 'green', 'gold', 'black', 'white', 'purple', 'orange', 'wine', 'cream', 'teal'];

/** Text search with combined filters and sorting. Visual similarity is handled by visual search. */
export default function Search() {
  const params = useLocalSearchParams<{ q?: string; categoryId?: string; title?: string; sort?: Filters['sort']; shopId?: string; houseId?: string; wholesaleOnly?: string }>();
  const insets = useSafeAreaInsets();
  const authed = useAuth((s) => s.status === 'authenticated');
  const fav = useFavourites();
  const qc = useQueryClient();
  const sheet = useRef<SheetHandle>(null);
  const [text, setText] = useState(params.q ?? '');
  const [query, setQuery] = useState(params.q ?? '');
  const [focused, setFocused] = useState(!params.q && !params.categoryId && !params.sort && !params.shopId);
  const [filters, setFilters] = useState<Filters>({ categoryId: params.categoryId, sort: params.sort ?? (params.q ? 'relevance' : 'newest'), wholesaleOnly: params.wholesaleOnly === '1' });
  const [draft, setDraft] = useState<Filters>(filters);

  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const suggestions = useQuery({
    queryKey: ['suggestions', text],
    queryFn: () => api.get<{ products: string[]; shops: { id: string; name: string; slug: string }[]; categories: { id: string; name: string }[]; houses: { id: string; houseNumber: string; name: string }[] }>('/search/suggestions', { q: text }),
    enabled: focused && text.trim().length >= 2,
  });
  const recent = useQuery({ queryKey: ['recent-searches'], queryFn: () => api.get<string[]>('/search/recent'), enabled: authed && focused });
  const clearRecent = useMutation({ mutationFn: () => api.del('/search/recent'), onSuccess: () => qc.invalidateQueries({ queryKey: ['recent-searches'] }) });

  const queryParams = useMemo(
    () => ({
      q: query || undefined,
      categoryId: filters.categoryId,
      shopId: params.shopId,
      houseId: params.houseId,
      minPriceKobo: filters.minPrice ? (nairaInputToKobo(filters.minPrice) ?? undefined) : undefined,
      maxPriceKobo: filters.maxPrice ? (nairaInputToKobo(filters.maxPrice) ?? undefined) : undefined,
      wholesaleOnly: filters.wholesaleOnly || undefined,
      inStockOnly: filters.inStockOnly || undefined,
      verifiedOnly: filters.verifiedOnly || undefined,
      colour: filters.colour,
      sort: filters.sort,
    }),
    [query, filters, params.shopId, params.houseId],
  );
  const activeFilterCount = [filters.categoryId, filters.minPrice, filters.maxPrice, filters.wholesaleOnly, filters.inStockOnly, filters.verifiedOnly, filters.colour].filter(Boolean).length;

  const submit = (value = text) => {
    setText(value);
    setQuery(value.trim());
    setFocused(false);
    if (value.trim() && filters.sort === 'newest') setFilters((f) => ({ ...f, sort: 'relevance' }));
  };

  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-2 pb-2 pt-2">
        <IconButton icon={ChevronLeft} label="Back" onPress={() => router.back()} />
        <View className="flex-1">
          <SearchBar value={text} onChangeText={setText} onSubmit={() => submit()} autoFocus={focused} onFocus={() => setFocused(true)} onPressVisual={() => router.push('/visual-search')} />
        </View>
        <IconButton icon={SlidersHorizontal} label="Filters" badge={activeFilterCount || undefined} onPress={() => { setDraft(filters); sheet.current?.open(); }} />
      </View>

      {focused ? (
        <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
          {text.trim().length >= 2 && suggestions.data ? (
            <>
              {suggestions.data.products.map((p) => (
                <Pressable key={p} onPress={() => submit(p)} className="border-b border-line py-3">
                  <Text className="text-base text-ink-800">{p}</Text>
                </Pressable>
              ))}
              {suggestions.data.shops.map((s) => (
                <Pressable key={s.id} onPress={() => router.push(`/shop/${s.slug}`)} className="border-b border-line py-3">
                  <Text className="text-base text-ink-800">{s.name}</Text>
                  <Text className="text-xs text-ink-500">Shop</Text>
                </Pressable>
              ))}
              {suggestions.data.houses.map((h) => (
                <Pressable key={h.id} onPress={() => router.push(`/house/${h.id}`)} className="border-b border-line py-3">
                  <Text className="text-base text-ink-800">House {h.houseNumber}</Text>
                  <Text className="text-xs text-ink-500">{h.name}</Text>
                </Pressable>
              ))}
              {suggestions.data.categories.map((c) => (
                <Pressable key={c.id} onPress={() => { setFilters((f) => ({ ...f, categoryId: c.id })); submit(''); }} className="border-b border-line py-3">
                  <Text className="text-base text-ink-800">{c.name}</Text>
                  <Text className="text-xs text-ink-500">Category</Text>
                </Pressable>
              ))}
            </>
          ) : recent.data?.length ? (
            <>
              <View className="mt-2 flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-ink-600">Recent searches</Text>
                <Pressable onPress={() => clearRecent.mutate()}>
                  <Text className="text-sm font-semibold text-brand-700">Clear</Text>
                </Pressable>
              </View>
              {recent.data.map((r) => (
                <Pressable key={r} onPress={() => submit(r)} className="flex-row items-center border-b border-line py-3">
                  <Clock size={16} color={colors.inkFaint} />
                  <Text className="ml-3 text-base text-ink-800">{r}</Text>
                </Pressable>
              ))}
            </>
          ) : (
            <Text className="mt-6 text-center text-sm text-ink-500">Search by fabric name, colour, pattern, shop name, shop code or house number (e.g. KW-024).</Text>
          )}
        </ScrollView>
      ) : (
        <>
          {params.title || activeFilterCount ? (
            <View className="flex-row flex-wrap px-4">
              {params.title ? <Chip label={params.title} selected /> : null}
              {filters.wholesaleOnly ? <Chip label="Wholesale" selected icon={X} onPress={() => setFilters((f) => ({ ...f, wholesaleOnly: false }))} /> : null}
              {filters.inStockOnly ? <Chip label="In stock" selected icon={X} onPress={() => setFilters((f) => ({ ...f, inStockOnly: false }))} /> : null}
              {filters.verifiedOnly ? <Chip label="Verified shops" selected icon={X} onPress={() => setFilters((f) => ({ ...f, verifiedOnly: false }))} /> : null}
              {filters.colour ? <Chip label={filters.colour} selected icon={X} onPress={() => setFilters((f) => ({ ...f, colour: undefined }))} /> : null}
            </View>
          ) : null}
          <PaginatedList<ProductSummaryDto>
            queryKey={['search', queryParams]}
            fetchPage={(page) => api.page<ProductSummaryDto>('/search/products', { ...queryParams, page, limit: 20 })}
            keyOf={(p) => p.id}
            numColumns={2}
            skeleton={<View className="px-4"><ProductGridSkeleton count={6} /></View>}
            contentPadding={12}
            header={params.shopId || params.houseId ? undefined : <ResellerStrip q={query || undefined} />}
            renderItem={(p) => (
              <View className="flex-1 px-1">
                <ProductCard product={p} favourite={fav.products.has(p.id)} onToggleFavourite={() => fav.toggle('product', p.id)} />
              </View>
            )}
            empty={{ title: 'No matching fabrics', message: 'Try fewer words, remove filters, or search with a photo instead.', action: 'Search by photo', onAction: () => router.push('/visual-search') }}
          />
        </>
      )}

      <Sheet
        ref={sheet}
        title="Filters & sorting"
        footer={
          <View className="flex-row">
            <Button title="Reset" variant="outline" className="mr-2 flex-1" onPress={() => setDraft({ sort: draft.sort })} />
            <Button title="Apply" className="flex-1" onPress={() => { setFilters(draft); setFocused(false); sheet.current?.close(); }} />
          </View>
        }
      >
        <ChoiceChips label="Sort by" options={SORTS as unknown as { value: Filters['sort']; label: string }[]} value={draft.sort} onChange={(v) => setDraft((d) => ({ ...d, sort: v ?? 'relevance' }))} />
        <ChoiceChips label="Category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={draft.categoryId} onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))} />
        <View className="flex-row">
          <TextField containerClassName="mr-2 flex-1" label="Min price (₦)" keyboardType="numeric" value={draft.minPrice ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, minPrice: t }))} />
          <TextField containerClassName="flex-1" label="Max price (₦)" keyboardType="numeric" value={draft.maxPrice ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, maxPrice: t }))} />
        </View>
        <ChoiceChips label="Colour" options={COLOURS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} value={draft.colour} onChange={(v) => setDraft((d) => ({ ...d, colour: v }))} />
        <SwitchRow label="Wholesale available" value={!!draft.wholesaleOnly} onChange={(v) => setDraft((d) => ({ ...d, wholesaleOnly: v }))} />
        <SwitchRow label="In stock only" value={!!draft.inStockOnly} onChange={(v) => setDraft((d) => ({ ...d, inStockOnly: v }))} />
        <SwitchRow label="Verified shops only" value={!!draft.verifiedOnly} onChange={(v) => setDraft((d) => ({ ...d, verifiedOnly: v }))} />
      </Sheet>
    </View>
  );
}
