import { useLocalSearchParams } from 'expo-router';
import type { QuotationDto } from '@kkdm/shared';
import { PaginatedList, Screen } from '@/components/ui';
import { QuotationRow } from '@/features/quotations';
import { api } from '@/lib/api';

/** Customer quotations, or a shop's quotation inbox when opened with ?shopId=. */
export default function Quotations() {
  const { shopId } = useLocalSearchParams<{ shopId?: string }>();
  return (
    <Screen title={shopId ? 'Quotation requests' : 'My quotations'} scroll={false} padded={false}>
      <PaginatedList<QuotationDto>
        queryKey={['quotations', shopId ?? 'mine']}
        fetchPage={(page) => api.page<QuotationDto>('/quotations', shopId ? { as: 'shop', shopId, page } : { as: 'customer', page })}
        keyOf={(q) => q.id}
        renderItem={(q) => <QuotationRow q={q} shopView={!!shopId} />}
        empty={{ title: 'No quotations yet', message: shopId ? 'Wholesale price requests from customers appear here.' : 'Request a wholesale quotation from any shop or product page.' }}
      />
    </Screen>
  );
}
