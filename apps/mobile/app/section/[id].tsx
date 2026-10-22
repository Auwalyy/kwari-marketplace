import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { HouseDto, SectionDto } from '@kkdm/shared';
import { Body, Button, ErrorState, LoadingView, PaginatedList, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { HouseRow } from '@/components/directory';

export default function SectionDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const section = useQuery({ queryKey: ['section', id], queryFn: () => api.get<SectionDto>(`/sections/${id}`) });
  if (section.isPending) return <Screen title="Section"><LoadingView /></Screen>;
  if (section.isError) return <Screen title="Section"><ErrorState error={section.error} onRetry={() => section.refetch()} /></Screen>;
  const s = section.data;
  return (
    <Screen title={`Section ${s.code}`} subtitle={s.name} scroll={false} padded={false}>
      <PaginatedList<HouseDto>
        queryKey={['houses', { sectionId: id }]}
        fetchPage={(page) => api.page<HouseDto>('/houses', { sectionId: id, page })}
        keyOf={(h) => h.id}
        header={
          <View className="pb-3 pt-2">
            {s.locationDescription ? <Body className="mb-2 text-sm">{s.locationDescription}</Body> : null}
            <Button title="Shops in this section" variant="secondary" size="sm" className="self-start" onPress={() => router.push({ pathname: '/shops', params: { sectionId: s.id, title: `Section ${s.code} shops` } })} />
          </View>
        }
        renderItem={(h) => <HouseRow h={h} />}
        empty={{ title: 'No houses in this section yet' }}
      />
    </Screen>
  );
}
