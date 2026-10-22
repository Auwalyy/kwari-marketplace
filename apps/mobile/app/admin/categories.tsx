import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import type { CategoryDto } from '@kkdm/shared';
import { Button, Card, Screen, Sheet, TextField, toast, type SheetHandle } from '@/components/ui';
import { api } from '@/lib/api';

export default function AdminCategories() {
  const qc = useQueryClient();
  const sheet = useRef<SheetHandle>(null);
  const q = useQuery({ queryKey: ['categories'], queryFn: () => api.get<CategoryDto[]>('/categories') });
  const [f, setF] = useState<{ id?: string; name: string; slug: string; description: string; sortOrder: string }>({ name: '', slug: '', description: '', sortOrder: '0' });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, slug: f.slug, description: f.description || undefined, sortOrder: Number(f.sortOrder) || 0 };
      return f.id ? api.patch(`/categories/${f.id}`, body) : api.post('/categories', body);
    },
    onSuccess: () => { toast.success('Saved'); sheet.current?.close(); void qc.invalidateQueries({ queryKey: ['categories'] }); },
    onError: (e) => toast.apiError(e),
  });
  const hide = useMutation({ mutationFn: (id: string) => api.patch(`/categories/${id}`, { active: false }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }), onError: (e) => toast.apiError(e) });
  return (
    <Screen title="Categories" footer={<Button title="Add category" icon={Plus} onPress={() => { setF({ name: '', slug: '', description: '', sortOrder: '0' }); sheet.current?.open(); }} fullWidth />}>
      {q.data?.map((c) => (
        <Card key={c.id} className="mb-2">
          <Text className="font-semibold text-ink-900">{c.name}</Text>
          <Text className="text-xs text-ink-500">/{c.slug} · {c.productCount ?? 0} published products</Text>
          <View className="mt-2 flex-row">
            <Button title="Edit" size="sm" variant="outline" className="mr-2" onPress={() => { setF({ id: c.id, name: c.name, slug: c.slug, description: c.description ?? '', sortOrder: '0' }); sheet.current?.open(); }} />
            <Button title="Hide" size="sm" variant="ghost" onPress={() => hide.mutate(c.id)} />
          </View>
        </Card>
      ))}
      <Sheet ref={sheet} title={f.id ? 'Edit category' : 'New category'} footer={<Button title="Save" onPress={() => save.mutate()} loading={save.isPending} disabled={f.name.length < 2 || f.slug.length < 2} fullWidth />}>
        <TextField label="Name" value={f.name} onChangeText={(t) => setF((x) => ({ ...x, name: t, slug: x.id ? x.slug : t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))} />
        <TextField label="Slug" value={f.slug} onChangeText={(t) => setF((x) => ({ ...x, slug: t.toLowerCase() }))} autoCapitalize="none" />
        <TextField label="Description" value={f.description} onChangeText={(t) => setF((x) => ({ ...x, description: t }))} />
        <TextField label="Sort order" keyboardType="number-pad" value={f.sortOrder} onChangeText={(t) => setF((x) => ({ ...x, sortOrder: t }))} />
      </Sheet>
    </Screen>
  );
}
