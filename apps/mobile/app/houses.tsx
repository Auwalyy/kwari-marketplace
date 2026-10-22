import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { HouseDto } from '@kkdm/shared';
import { Chip, PaginatedList, Screen } from '@/components/ui';
import { HouseRow } from '@/components/directory';
import { SearchBar } from '@/components/cards';
import { api } from '@/lib/api';

/** House directory (optionally within a market or section). */
export default function Houses() {
  const params = useLocalSearchParams<{ marketId?: string; sectionId?: string; title?: string }>();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const query = { marketId: params.marketId, sectionId: params.sectionId, q: q || undefined, verifiedOnly: verifiedOnly || undefined };
  return (
    <Screen title={params.title ?? 'Houses'} scroll={false} padded={false}>
      <View className="px-4 pb-1 pt-3">
        <SearchBar value={text} onChangeText={setText} onSubmit={() => setQ(text.trim())} placeholder="House number or name, e.g. KW-024" />
        <View className="mt-2 flex-row">
          <Chip label="Verified houses" selected={verifiedOnly} onPress={() => setVerifiedOnly((v) => !v)} />
        </View>
      </View>
      <PaginatedList<HouseDto>
        queryKey={['houses', query]}
        fetchPage={(page) => api.page<HouseDto>('/houses', { ...query, page })}
        keyOf={(h) => h.id}
        renderItem={(h) => <HouseRow h={h} />}
        empty={{ title: 'No houses found' }}
      />
    </Screen>
  );
}
