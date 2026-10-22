import type { ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { colors } from '@/constants/theme';
import type { Page } from '@/lib/api';
import { EmptyState, ErrorState, ListSkeleton } from './feedback';

interface PaginatedListProps<T> {
  queryKey: QueryKey;
  fetchPage: (page: number) => Promise<Page<T>>;
  renderItem: (item: T, index: number) => ReactElement | null;
  keyOf: (item: T) => string;
  empty?: { title: string; message?: string; action?: string; onAction?: () => void };
  header?: ReactElement | null;
  numColumns?: number;
  enabled?: boolean;
  skeleton?: ReactElement;
  contentPadding?: number;
  listProps?: Partial<FlashListProps<T>>;
}

/**
 * Virtualised, paginated list backed by TanStack Query: pull-to-refresh, infinite loading,
 * skeleton, empty and error states. Never loads a whole catalogue at once.
 */
export function PaginatedList<T>({ queryKey, fetchPage, renderItem, keyOf, empty, header, numColumns, enabled = true, skeleton, contentPadding = 16, listProps }: PaginatedListProps<T>) {
  const q = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => (last.meta.hasNextPage ? last.meta.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isPending && enabled) return <View className="flex-1">{header}{skeleton ?? <ListSkeleton />}</View>;
  if (q.isError && !items.length) return <View className="flex-1">{header}<ErrorState error={q.error} onRetry={() => q.refetch()} /></View>;

  return (
    <FlashList
      data={items}
      numColumns={numColumns}
      keyExtractor={keyOf}
      renderItem={({ item, index }) => renderItem(item, index)}
      ListHeaderComponent={header}
      ListEmptyComponent={empty ? <EmptyState {...empty} /> : null}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={0.4}
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} /> : <View style={{ height: 24 }} />}
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
      contentContainerStyle={{ paddingHorizontal: contentPadding, paddingTop: 8 }}
      {...listProps}
    />
  );
}
