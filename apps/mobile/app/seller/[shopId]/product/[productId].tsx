import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2 } from 'lucide-react-native';
import { UNIT_LABELS, productCreateSchema, type CategoryDto, type MeasurementUnit, type ProductDto, type ShopDto } from '@kkdm/shared';
import { Badge, Body, Button, Card, ChoiceChips, ErrorState, IconButton, ImagePickerRow, LoadingView, Notice, Screen, SectionHeader, SwitchRow, TextField, pickImages, toast, useConfirm } from '@/components/ui';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { useDerivedState } from '@/hooks/useDerivedState';
import { koboToNairaInput, nairaInputToKobo } from '@/lib/format';

interface VariantForm {
  id?: string;
  label: string;
  colour: string;
  priceOverride: string;
  stock: string;
  active: boolean;
}

const EMBED_LABEL = { pending: ['Search indexing queued', 'warning'], processing: ['Indexing…', 'info'], ready: ['Visual search ready', 'success'], failed: ['Indexing failed', 'danger'], disabled: ['Visual search off', 'neutral'] } as const;

/** Add / edit a product. Stock changes after creation go through the inventory screen (audited). */
export default function ProductEditor() {
  const { shopId, productId } = useLocalSearchParams<{ shopId: string; productId: string }>();
  const isNew = productId === 'new';
  const qc = useQueryClient();
  const confirm = useConfirm();
  const shop = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<ShopDto>(`/shops/${shopId}`) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const product = useQuery({ queryKey: ['seller-product', productId], queryFn: () => api.get<ProductDto & { moderationStatus: string; moderationReason?: string }>(`/shops/${shopId}/products/${productId}`), enabled: !isNew });
  const [f, setF] = useDerivedState(
    product.data,
    (p) => ({ name: p.name, description: p.description ?? '', categoryId: p.categoryId, subcategory: p.subcategory ?? '', retail: koboToNairaInput(p.retailPriceKobo), wholesale: koboToNairaInput(p.wholesalePriceKobo), wholesaleMin: p.wholesaleMinQuantity ? String(p.wholesaleMinQuantity) : '', minOrder: String(p.minOrderQuantity), unit: p.unit, stock: String(p.stockQuantity), lowStock: String(p.lowStockThreshold), trackInventory: p.trackInventory, material: p.material ?? '', brand: p.brand ?? '', colours: p.colours.join(', '), patterns: p.patterns.join(', '), keywords: p.keywords.join(', ') }),
    { name: '', description: '', categoryId: '', subcategory: '', retail: '', wholesale: '', wholesaleMin: '', minOrder: '1', unit: 'yard' as MeasurementUnit, stock: '0', lowStock: '5', trackInventory: true, material: '', brand: '', colours: '', patterns: '', keywords: '' },
  );
  const [variants, setVariants] = useDerivedState<ProductDto, VariantForm[]>(product.data, (p) => p.variants.map((v) => ({ id: v.id, label: v.label, colour: v.colour ?? '', priceOverride: koboToNairaInput(v.priceOverrideKobo), stock: String(v.stockQuantity), active: v.active })), []);
  const [newImages, setNewImages] = useState<{ key: string; uri: string; name: string; type: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const list = (s: string) => s.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const buildBody = () => ({
    name: f.name,
    description: f.description || undefined,
    categoryId: f.categoryId,
    subcategory: f.subcategory || undefined,
    retailPriceKobo: nairaInputToKobo(f.retail) ?? -1,
    wholesalePriceKobo: f.wholesale ? nairaInputToKobo(f.wholesale) : null,
    wholesaleMinQuantity: f.wholesaleMin ? Number(f.wholesaleMin) : null,
    minOrderQuantity: Number(f.minOrder) || 1,
    unit: f.unit,
    ...(isNew ? { stockQuantity: Number(f.stock) || 0 } : {}),
    lowStockThreshold: Number(f.lowStock) || 0,
    trackInventory: f.trackInventory,
    material: f.material || undefined,
    brand: f.brand || undefined,
    colours: list(f.colours),
    patterns: list(f.patterns),
    keywords: list(f.keywords),
    variants: variants.map((v) => ({ _id: v.id, label: v.label, colour: v.colour || undefined, priceOverrideKobo: v.priceOverride ? nairaInputToKobo(v.priceOverride) : null, stockQuantity: Number(v.stock) || 0, active: v.active })),
  });

  const uploadImages = async (id: string) => {
    if (!newImages.length) return;
    await api.upload(`/shops/${shopId}/products/${id}/images`, newImages.map((i) => ({ field: 'images', uri: i.uri, name: i.name, type: i.type })));
    setNewImages([]);
  };
  const save = useMutation({
    mutationFn: async (publish?: boolean) => {
      const body = buildBody();
      const parsed = productCreateSchema.safeParse({ ...body, stockQuantity: Number(f.stock) || 0 });
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        throw new Error(parsed.error.issues[0].message);
      }
      setErrors({});
      const saved = isNew ? await api.post<ProductDto>(`/shops/${shopId}/products`, body) : await api.patch<ProductDto>(`/shops/${shopId}/products/${productId}`, body);
      await uploadImages(saved.id);
      if (publish) await api.patch(`/shops/${shopId}/products/${saved.id}`, { status: 'published' });
      return saved;
    },
    onSuccess: (p, publish) => {
      void qc.invalidateQueries({ queryKey: ['seller-products', shopId] });
      void qc.invalidateQueries({ queryKey: ['seller-product', p.id] });
      toast.success(publish ? 'Published' : 'Saved');
      if (isNew) router.replace(`/seller/${shopId}/product/${p.id}`);
    },
    onError: (e) => toast.apiError(e),
  });
  const simple = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void product.refetch();
      void qc.invalidateQueries({ queryKey: ['seller-products', shopId] });
    },
    onError: (e) => toast.apiError(e),
  });

  if (!isNew && product.isPending) return <Screen title="Product"><LoadingView /></Screen>;
  if (!isNew && product.isError) return <Screen title="Product"><ErrorState error={product.error} /></Screen>;
  const p = product.data;
  const units = shop.data?.enabledUnits ?? ['yard', 'piece'];

  return (
    <Screen
      title={isNew ? 'Add product' : 'Edit product'}
      subtitle={p ? p.status : undefined}
      footer={
        <View className="flex-row">
          <Button title={isNew ? 'Save as draft' : 'Save'} variant="outline" className="mr-2 flex-1" onPress={() => save.mutate(false)} loading={save.isPending && save.variables === false} />
          {p?.status !== 'published' ? <Button title="Save & publish" className="flex-1" onPress={() => save.mutate(true)} loading={save.isPending && save.variables === true} /> : null}
        </View>
      }
    >
      {p?.moderationStatus && p.moderationStatus !== 'approved' ? <Notice tone="danger" title={`Moderation: ${p.moderationStatus}`}>{p.moderationReason ?? 'Contact support for details.'}</Notice> : null}

      <SectionHeader title="Photos" />
      {p?.images.map((img) => (
        <View key={img.id} className="mb-2 flex-row items-center rounded-xl border border-line bg-white p-2">
          <Image source={{ uri: img.thumbnailUrl }} style={{ width: 56, height: 56, borderRadius: 8 }} />
          <View className="ml-3 flex-1">
            <Badge label={EMBED_LABEL[img.embeddingStatus][0]} tone={EMBED_LABEL[img.embeddingStatus][1]} />
          </View>
          <IconButton
            icon={Trash2}
            label="Delete photo"
            onPress={async () => {
              if ((await confirm({ title: 'Delete this photo?', destructive: true, confirmLabel: 'Delete' })).confirmed) simple.mutate(() => api.del(`/shops/${shopId}/products/${productId}/images/${img.id}`));
            }}
          />
        </View>
      ))}
      {p?.images.some((i) => i.embeddingStatus === 'failed') ? <Button title="Retry visual-search indexing" icon={RefreshCw} variant="ghost" size="sm" className="mb-2 self-start" onPress={() => simple.mutate(() => api.post(`/shops/${shopId}/products/${productId}/images/retry-embeddings`))} /> : null}
      <ImagePickerRow
        images={newImages}
        max={8 - (p?.images.length ?? 0)}
        onRemove={(key) => setNewImages((imgs) => imgs.filter((i) => i.key !== key))}
        onAdd={async (source) => {
          const picked = await pickImages(source, { multiple: source === 'library', limit: 8 - (p?.images.length ?? 0) - newImages.length });
          setNewImages((imgs) => [...imgs, ...picked.map((x) => ({ ...x, key: x.uri }))]);
        }}
      />
      <Body className="-mt-2 mb-2 text-xs">Use clear, well-lit photos of the fabric itself — these power “find fabric by image”. New photos upload when you save.</Body>

      <SectionHeader title="Details" />
      <TextField label="Product name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t }))} error={errors.name} />
      <ChoiceChips label="Category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v ?? '' }))} />
      {errors.categoryId ? <Text className="-mt-2 mb-2 text-sm text-danger-500">Choose a category</Text> : null}
      <TextField label="Subcategory (optional)" value={f.subcategory} onChangeText={(t) => setF((x) => ({ ...x, subcategory: t }))} />
      <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} multiline />

      <SectionHeader title="Pricing" />
      <ChoiceChips label="Sold by" options={units.map((u) => ({ value: u, label: UNIT_LABELS[u].singular }))} value={f.unit} onChange={(v) => v && setF((x) => ({ ...x, unit: v }))} />
      <TextField label={`Retail price per ${UNIT_LABELS[f.unit].singular} (₦)`} keyboardType="numeric" value={f.retail} onChangeText={(t) => setF((x) => ({ ...x, retail: t }))} error={errors.retailPriceKobo} />
      <View className="flex-row">
        <TextField containerClassName="mr-2 flex-1" label="Wholesale price (₦)" keyboardType="numeric" value={f.wholesale} onChangeText={(t) => setF((x) => ({ ...x, wholesale: t }))} error={errors.wholesalePriceKobo} />
        <TextField containerClassName="flex-1" label={`From (${UNIT_LABELS[f.unit].plural})`} keyboardType="decimal-pad" value={f.wholesaleMin} onChangeText={(t) => setF((x) => ({ ...x, wholesaleMin: t }))} error={errors.wholesaleMinQuantity} />
      </View>
      <TextField label="Minimum order quantity" keyboardType="decimal-pad" value={f.minOrder} onChangeText={(t) => setF((x) => ({ ...x, minOrder: t }))} />

      <SectionHeader title="Stock" />
      <SwitchRow label="Track stock" description="Turn off for made-to-order items" value={f.trackInventory} onChange={(v) => setF((x) => ({ ...x, trackInventory: v }))} />
      {isNew && !variants.length ? <TextField label={`Opening stock (${UNIT_LABELS[f.unit].plural})`} keyboardType="decimal-pad" value={f.stock} onChangeText={(t) => setF((x) => ({ ...x, stock: t }))} /> : null}
      {!isNew ? (
        <Card className="mb-3">
          <Text className="text-sm text-ink-700">In stock: {p?.stockQuantity} {UNIT_LABELS[f.unit].plural}</Text>
          <Button title="Adjust stock" variant="secondary" size="sm" className="mt-2 self-start" onPress={() => router.push({ pathname: `/seller/${shopId}/inventory`, params: { productId } })} />
        </Card>
      ) : null}
      <TextField label="Low-stock alert at" keyboardType="decimal-pad" value={f.lowStock} onChangeText={(t) => setF((x) => ({ ...x, lowStock: t }))} />

      <SectionHeader title="Options (colour / pattern / size)" />
      {variants.map((v, i) => (
        <Card key={v.id ?? i} className="mb-2">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink-900">Option {i + 1}</Text>
            <IconButton icon={Trash2} label="Remove option" onPress={() => setVariants((vs) => vs.filter((_, j) => j !== i))} />
          </View>
          <TextField label="Label" value={v.label} onChangeText={(t) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, label: t } : x)))} placeholder="e.g. Wine & cream" />
          <View className="flex-row">
            <TextField containerClassName="mr-2 flex-1" label="Colour" value={v.colour} onChangeText={(t) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, colour: t } : x)))} />
            <TextField containerClassName="flex-1" label="Price override (₦)" keyboardType="numeric" value={v.priceOverride} onChangeText={(t) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, priceOverride: t } : x)))} />
          </View>
          {!v.id ? <TextField label="Opening stock" keyboardType="decimal-pad" value={v.stock} onChangeText={(t) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, stock: t } : x)))} /> : <Text className="mb-2 text-xs text-ink-500">Stock: {v.stock} (adjust in Inventory)</Text>}
          <SwitchRow label="Available" value={v.active} onChange={(val) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, active: val } : x)))} />
        </Card>
      ))}
      <Pressable onPress={() => setVariants((vs) => [...vs, { label: '', colour: '', priceOverride: '', stock: '0', active: true }])} className="mb-2 flex-row items-center">
        <Plus size={16} color={colors.brand} />
        <Text className="ml-1 font-semibold text-brand-700">Add option</Text>
      </Pressable>

      <SectionHeader title="Search details" />
      <TextField label="Material (if known)" value={f.material} onChangeText={(t) => setF((x) => ({ ...x, material: t }))} hint="State only what you know — e.g. “100% cotton (supplier label)”" />
      <TextField label="Brand / manufacturer" value={f.brand} onChangeText={(t) => setF((x) => ({ ...x, brand: t }))} />
      <TextField label="Colours (comma separated)" value={f.colours} onChangeText={(t) => setF((x) => ({ ...x, colours: t }))} />
      <TextField label="Patterns (comma separated)" value={f.patterns} onChangeText={(t) => setF((x) => ({ ...x, patterns: t }))} placeholder="floral, geometric, stripes" />
      <TextField label="Keywords" value={f.keywords} onChangeText={(t) => setF((x) => ({ ...x, keywords: t }))} placeholder="ankara, asoebi, wedding" />

      {!isNew && p ? (
        <View className="mt-4">
          {p.status === 'published' ? <Button title="Unpublish (move to drafts)" variant="outline" className="mb-2" onPress={() => simple.mutate(() => api.patch(`/shops/${shopId}/products/${productId}`, { status: 'draft' }))} fullWidth /> : null}
          {p.status !== 'archived' ? (
            <Button
              title="Archive product"
              variant="ghost"
              onPress={async () => {
                if ((await confirm({ title: 'Archive this product?', message: 'It will be hidden from customers. Order history is kept.', confirmLabel: 'Archive' })).confirmed) simple.mutate(() => api.del(`/shops/${shopId}/products/${productId}`));
              }}
              fullWidth
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
