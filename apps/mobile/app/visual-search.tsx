import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { Camera, ImagePlus, RefreshCw, ScanSearch, Search, SlidersHorizontal, X } from 'lucide-react-native';
import type { CategoryDto, VisualMatchDto, VisualSearchResponse } from '@kkdm/shared';
import { Badge, Button, ChoiceChips, EmptyState, IconButton, Notice, Screen, Sheet, SwitchRow, TextField, pickImages, type PickedImage, type SheetHandle } from '@/components/ui';
import { LocationBreadcrumbView, StockIndicator } from '@/components/ui/commerce';
import { colors } from '@/constants/theme';
import { useAppConfig } from '@/hooks';
import { ApiError, http, toApiError } from '@/lib/api';
import { formatNaira, nairaInputToKobo, unitLabel } from '@/lib/format';

interface Filters {
  categoryId?: string;
  maxPrice?: string;
  wholesaleOnly?: boolean;
  inStockOnly?: boolean;
}

const RELEVANCE: Record<VisualMatchDto['relevance'], { label: string; tone: 'success' | 'info' | 'neutral' }> = {
  very_similar: { label: 'Very similar', tone: 'success' },
  similar: { label: 'Similar', tone: 'info' },
  somewhat_similar: { label: 'Somewhat similar', tone: 'neutral' },
};

type Phase = 'pick' | 'preview' | 'searching' | 'results' | 'error';

/**
 * Find fabric by image. Results are ranked by visual similarity; they are never presented as exact
 * matches, and a failure never falls back to unrelated products — it offers text search instead.
 */
export default function VisualSearch() {
  const config = useAppConfig();
  const sheet = useRef<SheetHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<VisualSearchResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState<Filters>({});
  const [draft, setDraft] = useState<Filters>({});
  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => (await http.get('/categories')).data.data as CategoryDto[] });

  const unavailable = config.data && !config.data.features.visualSearch.available;
  const filterParams = (f: Filters, page = 1) => ({
    categoryId: f.categoryId,
    maxPriceKobo: f.maxPrice ? (nairaInputToKobo(f.maxPrice) ?? undefined) : undefined,
    wholesaleOnly: f.wholesaleOnly || undefined,
    inStockOnly: f.inStockOnly || undefined,
    page,
    limit: 20,
  });

  const choose = async (source: 'camera' | 'library') => {
    const [picked] = await pickImages(source, { crop: true });
    if (picked) {
      setImage(picked);
      setResult(null);
      setError(null);
      setPhase('preview');
    }
  };

  const search = async (f: Filters = filters, img = image) => {
    if (!img) return;
    setPhase('searching');
    setProgress(0);
    setError(null);
    abort.current = new AbortController();
    try {
      const form = new FormData();
      if (img.uri.startsWith('blob:') || img.uri.startsWith('data:')) form.append('image', await (await fetch(img.uri)).blob(), img.name);
      else form.append('image', { uri: img.uri, name: img.name, type: img.type } as unknown as Blob);
      const res = await http.post('/visual-search', form, {
        params: filterParams(f),
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: abort.current.signal,
        timeout: 90_000,
        onUploadProgress: (e) => e.total && setProgress(e.loaded / e.total),
      });
      setResult(res.data.data as VisualSearchResponse);
      setPhase('results');
    } catch (e) {
      if ((e as { name?: string }).name === 'CanceledError') {
        setPhase('preview');
        return;
      }
      setError(toApiError(e));
      setPhase('error');
    }
  };

  const loadMore = async () => {
    if (!result?.meta.hasNextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await http.get(`/visual-search/results/${result.meta.searchId}`, { params: filterParams(filters, result.meta.page + 1) });
      const next = res.data.data as VisualSearchResponse;
      setResult({ matches: [...result.matches, ...next.matches], meta: next.meta });
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setPhase('pick');
  };

  return (
    <Screen
      title="Find fabric by image"
      right={phase === 'results' ? <IconButton icon={SlidersHorizontal} label="Filter results" onPress={() => { setDraft(filters); sheet.current?.open(); }} /> : undefined}
      scroll={false}
      padded={false}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} onScroll={(e) => {
        const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
        if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) void loadMore();
      }} scrollEventThrottle={250}>
        {unavailable ? (
          <EmptyState icon={ScanSearch} title="Visual search is unavailable" message="The image-matching service isn’t configured or is temporarily down. You can still search by text or browse categories." action="Search by text" onAction={() => router.replace('/search')} />
        ) : null}
        {config.data?.features.visualSearch.developmentOnly ? <Notice tone="warning" title="Development mode">This server uses a simple colour/pattern baseline instead of a production image model. Results are indicative only.</Notice> : null}

        {!unavailable && phase === 'pick' ? (
          <View>
            <View className="mb-6 items-center rounded-2xl bg-brand-800 px-6 py-8">
              <ScanSearch size={44} color={colors.gold} />
              <Text className="mt-3 text-center text-xl font-bold text-white">Show us the fabric</Text>
              <Text className="mt-2 text-center text-sm leading-5 text-brand-100">Photograph the fabric in good light, filling the frame with the pattern. We’ll find visually similar fabrics in Kantin Kwari shops.</Text>
            </View>
            <Button title="Take a photo" icon={Camera} onPress={() => void choose('camera')} fullWidth size="lg" className="mb-3" />
            <Button title="Choose from gallery" icon={ImagePlus} variant="outline" onPress={() => void choose('library')} fullWidth size="lg" />
            <Text className="mt-6 text-center text-xs leading-5 text-ink-500">Your photo is used only to run this search and is not stored. Location data in photos is removed.</Text>
          </View>
        ) : null}

        {image && phase !== 'pick' ? (
          <View className="mb-4 flex-row items-center rounded-2xl border border-line bg-white p-3">
            <Image source={{ uri: image.uri }} style={{ width: 72, height: 72, borderRadius: 12 }} contentFit="cover" />
            <View className="ml-3 flex-1">
              <Text className="font-semibold text-ink-900">{phase === 'results' ? `${result?.meta.total ?? 0} similar fabrics` : 'Your fabric photo'}</Text>
              <Pressable onPress={reset} className="mt-1 flex-row items-center">
                <RefreshCw size={14} color={colors.brand} />
                <Text className="ml-1 text-sm font-semibold text-brand-700">Use another image</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {phase === 'preview' ? (
          <>
            <Text className="mb-3 text-sm text-ink-600">Tip: crop to just the fabric — backgrounds and people reduce match quality.</Text>
            <Button title="Find similar fabrics" icon={Search} onPress={() => void search()} fullWidth size="lg" className="mb-3" />
            <Button title="Retake / choose again" variant="outline" onPress={reset} fullWidth />
          </>
        ) : null}

        {phase === 'searching' ? (
          <View className="items-center py-10">
            <ActivityIndicator size="large" color={colors.brand} />
            <Text className="mt-4 text-base font-semibold text-ink-800">{progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'Comparing with fabrics in the market…'}</Text>
            <Button title="Cancel" variant="ghost" icon={X} onPress={() => abort.current?.abort()} className="mt-4" />
          </View>
        ) : null}

        {phase === 'error' && error ? (
          <View className="py-6">
            <EmptyState icon={ScanSearch} title={error.status === 503 ? 'Visual search is temporarily unavailable' : 'We could not search with this image'} message={error.message} />
            <Button title="Try again" icon={RefreshCw} onPress={() => void search()} fullWidth className="mb-3" />
            <Button title="Search by text instead" variant="outline" onPress={() => router.replace('/search')} fullWidth />
          </View>
        ) : null}

        {phase === 'results' && result ? (
          result.matches.length ? (
            <>
              <Text className="mb-3 text-xs text-ink-500">Ranked by visual similarity (colour, pattern and overall design). Similar does not mean identical — confirm details with the seller.</Text>
              {result.matches.map((m) => (
                <MatchCard key={m.product.id} match={m} />
              ))}
              {loadingMore ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} /> : null}
            </>
          ) : (
            <EmptyState icon={ScanSearch} title="No similar fabrics found" message="Nothing in the catalogue looks close enough. Try another photo with better light, loosen your filters, or search by text." action="Search by text" onAction={() => router.replace('/search')} />
          )
        ) : null}
      </ScrollView>

      <Sheet
        ref={sheet}
        title="Filter matches"
        footer={
          <View className="flex-row">
            <Button title="Reset" variant="outline" className="mr-2 flex-1" onPress={() => setDraft({})} />
            <Button title="Apply" className="flex-1" onPress={() => { setFilters(draft); sheet.current?.close(); void search(draft); }} />
          </View>
        }
      >
        <ChoiceChips label="Category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={draft.categoryId} onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))} />
        <TextField label="Maximum price (₦)" keyboardType="numeric" value={draft.maxPrice ?? ''} onChangeText={(t) => setDraft((d) => ({ ...d, maxPrice: t }))} />
        <SwitchRow label="Wholesale available" value={!!draft.wholesaleOnly} onChange={(v) => setDraft((d) => ({ ...d, wholesaleOnly: v }))} />
        <SwitchRow label="In stock only" value={!!draft.inStockOnly} onChange={(v) => setDraft((d) => ({ ...d, inStockOnly: v }))} />
      </Sheet>
    </Screen>
  );
}

function MatchCard({ match }: { match: VisualMatchDto }) {
  const p = match.product;
  const band = RELEVANCE[match.relevance];
  return (
    <Pressable onPress={() => router.push(`/product/${p.id}`)} className="mb-3 flex-row rounded-2xl border border-line bg-white p-3 active:bg-cream-50" accessibilityRole="button">
      <Image source={{ uri: match.matchedImageUrl || p.thumbnailUrl || undefined }} style={{ width: 96, height: 96, borderRadius: 12 }} contentFit="cover" />
      <View className="ml-3 flex-1">
        <View className="mb-1 flex-row items-center">
          <Badge label={band.label} tone={band.tone} />
          <Text className="ml-2 text-xs text-ink-400">{Math.round(match.similarity * 100)}% similarity</Text>
        </View>
        <Text numberOfLines={2} className="text-sm font-semibold text-ink-900">
          {p.name}
        </Text>
        <Text className="mt-0.5 text-base font-bold text-ink-900">
          {formatNaira(p.retailPriceKobo)}
          <Text className="text-xs font-normal text-ink-500"> / {unitLabel(p.unit)}</Text>
        </Text>
        <Pressable onPress={() => router.push(`/shop/${p.shop.slug}`)}>
          <Text numberOfLines={1} className="text-xs font-semibold text-brand-700">
            {p.shop.name}
          </Text>
        </Pressable>
        <LocationBreadcrumbView breadcrumb={p.shop.breadcrumb} compact />
        {p.stockStatus !== 'in_stock' ? (
          <View className="mt-1">
            <StockIndicator status={p.stockStatus} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
