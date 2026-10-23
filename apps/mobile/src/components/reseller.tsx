import type { ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Inbox, Pencil, Plus, Search, Share2, Tags } from 'lucide-react-native';
import type { ResellerListingDto, ResellerRequestDto, ResellerSummaryDto } from '@kkdm/shared';
import { Badge, Button, IconButton } from '@/components/ui';
import { Figure, QuickAction, ShopTile } from '@/components/seller';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { formatNaira, timeAgo, unitLabel } from '@/lib/format';
import { useAuth } from '@/store/auth';

/** The signed-in person's reseller account, if they have applied. */
export function useMyReseller() {
  return useAuth((s) => s.user?.reseller ?? null);
}

/** Public link to a reseller's page, for sharing on WhatsApp and elsewhere. */
export function resellerShareText(businessName: string, slug: string) {
  return `Buy fabric from ${businessName} on Kantin Kwari Digital Market: ${API_URL.replace(/\/$/, '')}/r/${slug}\nOr open the Kantin Kwari app and search "${businessName}".`;
}

/** Resellers' products matching a search, as a horizontal strip above the shop results. */
export function ResellerStrip({ q }: { q?: string }) {
  const res = useQuery({ queryKey: ['reseller-listings', q], queryFn: () => api.page<ResellerListingDto>('/reseller-listings', { q, limit: 12 }), enabled: !!q });
  if (!q || !res.data?.items.length) return null;
  return (
    <View className="mb-2">
      <Text className="mb-2 px-1 text-sm font-bold text-ink-800">From resellers</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {res.data.items.map((l) => (
          <Pressable key={l.id} onPress={() => router.push(`/listing/${l.id}`)} className="mr-2 w-36 overflow-hidden rounded-2xl border border-line bg-white active:opacity-90">
            <View className="h-28 bg-cream-200">{l.product.thumbnailUrl ? <Image source={{ uri: l.product.thumbnailUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}</View>
            <View className="p-2">
              <Text numberOfLines={1} className="text-xs font-semibold text-ink-900">{l.product.name}</Text>
              <Text className="text-sm font-bold text-ink-900">{formatNaira(l.priceKobo)}</Text>
              <Text numberOfLines={1} className="text-[11px] font-semibold text-brand-700">{l.reseller.businessName}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Text className="mb-1 mt-3 px-1 text-sm font-bold text-ink-800">From shops</Text>
    </View>
  );
}

/** A reseller's product as customers see it: the reseller's price and name, never the shop's. */
export function ListingCard({ listing }: { listing: ResellerListingDto }) {
  return (
    <Pressable onPress={() => router.push(`/listing/${listing.id}`)} className="mb-3 w-[48.5%] overflow-hidden rounded-2xl border border-line bg-white active:opacity-90" accessibilityRole="button">
      <View className="aspect-square bg-cream-200">{listing.product.thumbnailUrl ? <Image source={{ uri: listing.product.thumbnailUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : null}</View>
      <View className="p-2.5">
        <Text numberOfLines={2} className="text-sm font-semibold text-ink-900">{listing.product.name}</Text>
        <Text className="mt-1 text-base font-bold text-ink-900">
          {formatNaira(listing.priceKobo)}
          <Text className="text-xs font-normal text-ink-500"> / {unitLabel(listing.product.unit)}</Text>
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs font-semibold text-brand-700">{listing.reseller.businessName}</Text>
      </View>
    </Pressable>
  );
}

function RequestRow({ r }: { r: ResellerRequestDto }) {
  return (
    <Pressable onPress={() => router.push('/reseller/requests')} className="mb-2 flex-row items-center rounded-2xl border border-line bg-white p-3 active:bg-cream-50">
      <View className="h-10 w-10 overflow-hidden rounded-lg bg-cream-200">{r.listing.thumbnailUrl ? <Image source={{ uri: r.listing.thumbnailUrl }} style={{ width: 40, height: 40 }} /> : null}</View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={1} className="text-sm font-semibold text-ink-900">{r.customer.fullName} wants {r.quantity} {unitLabel(r.listing.unit, r.quantity)}</Text>
        <Text numberOfLines={1} className="text-xs text-ink-500">{r.listing.name} · {timeAgo(r.createdAt)}</Text>
      </View>
      <Badge label="New" tone="gold" />
    </Pressable>
  );
}

/**
 * The reseller's home: today's money, the everyday jobs as big buttons (find products to resell, record
 * a sale, share my page), new customer requests, and products that need a new price.
 */
export function ResellerHome({ topInset = 0, switcher }: { topInset?: number; switcher?: ReactNode }) {
  const me = useMyReseller();
  const summary = useQuery({ queryKey: ['reseller', 'summary', 'today'], queryFn: () => api.get<ResellerSummaryDto>('/resellers/me/summary', { period: 'today' }) });
  const month = useQuery({ queryKey: ['reseller', 'summary', 'month'], queryFn: () => api.get<ResellerSummaryDto>('/resellers/me/summary', { period: 'month' }) });
  const requests = useQuery({ queryKey: ['reseller', 'requests', 'new'], queryFn: () => api.page<ResellerRequestDto>('/resellers/me/requests', { status: 'new', limit: 5 }) });
  const listings = useQuery({ queryKey: ['reseller', 'listings'], queryFn: () => api.page<ResellerListingDto>('/resellers/me/listings', { limit: 50 }) });
  if (!me) return null;
  const t = summary.data;
  const attention = (listings.data?.items ?? []).filter((l) => l.status === 'active' && !l.available);
  const refresh = () => {
    void summary.refetch();
    void month.refetch();
    void requests.refetch();
    void listings.refetch();
  };

  return (
    <ScrollView className="flex-1 bg-cream-100" contentContainerStyle={{ paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={refresh} tintColor={colors.white} colors={[colors.brand]} />}>
      <View className="rounded-b-3xl bg-brand-700 px-4 pb-4" style={{ paddingTop: topInset + 8 }}>
        {switcher}
        <View className="flex-row items-start">
          <View className="flex-1">
            <Text numberOfLines={1} className="text-2xl font-bold text-white">{me.businessName}</Text>
            <Text className="mt-0.5 text-sm text-brand-100">Reseller</Text>
          </View>
          <IconButton icon={Pencil} label="Edit my reseller profile" color={colors.white} onPress={() => router.push('/reseller/apply')} />
        </View>
        {t ? (
          <View className="mt-4 rounded-2xl bg-white/10 p-3.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-brand-100">Today</Text>
            <View className="mt-1 flex-row">
              <View className="flex-1">
                <Figure label="Sales" value={formatNaira(t.salesKobo)} hint={`${t.salesCount} sale${t.salesCount === 1 ? '' : 's'}`} tone="light" big />
              </View>
              <View className="items-end">
                <Figure label="Your profit" value={formatNaira(t.profitKobo)} tone="light" />
                <Figure label="This month" value={formatNaira(month.data?.profitKobo ?? 0)} tone="light" />
              </View>
            </View>
            {t.owedKobo ? (
              <Text onPress={() => router.push({ pathname: '/reseller/sales', params: { owing: '1' } })} className="mt-1 text-xs font-semibold text-gold-100">
                Customers owe you {formatNaira(t.owedKobo)} · see who →
              </Text>
            ) : null}
          </View>
        ) : null}
        <View className="-mx-1 mt-4 flex-row">
          <QuickAction icon={Search} label="Find products" primary onPress={() => router.push('/search')} />
          <QuickAction icon={Plus} label="Record a sale" onPress={() => router.push({ pathname: '/reseller/sales', params: { add: '1' } })} />
          <QuickAction icon={Share2} label="Share my page" onPress={() => void Share.share({ message: resellerShareText(me.businessName, me.slug) })} />
        </View>
      </View>

      <View className="px-4">
        {requests.data?.items.length ? (
          <>
            <Text className="mb-2 mt-5 text-lg font-bold text-ink-900">Customers waiting</Text>
            {requests.data.items.map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </>
        ) : null}

        {attention.length ? (
          <Pressable onPress={() => router.push('/reseller/listings')} className="mt-5 flex-row rounded-2xl border border-line bg-warning-50 p-3">
            <AlertTriangle size={18} color={colors.warning} />
            <View className="ml-2.5 flex-1">
              <Text className="text-sm font-bold text-ink-900">{attention.length} product{attention.length > 1 ? 's are' : ' is'} hidden from customers</Text>
              <Text className="mt-0.5 text-[13px] text-ink-600">{attention[0].unavailableReason}. Tap to fix.</Text>
            </View>
          </Pressable>
        ) : null}

        {!listings.data?.items.length && listings.isFetched ? (
          <View className="mt-5 rounded-2xl border border-line bg-white p-4">
            <Text className="text-base font-bold text-ink-900">Start reselling</Text>
            <Text className="mt-1 text-sm leading-5 text-ink-600">
              Open any product that shows a reseller price, tap “Add to my products” and set your own price. Your customers see it under your name, and you keep the difference.
            </Text>
            <Button title="Find products to resell" icon={Search} className="mt-3" onPress={() => router.push('/search')} />
          </View>
        ) : null}

        <Text className="mb-2 mt-5 text-lg font-bold text-ink-900">Your business</Text>
        <View className="flex-row flex-wrap justify-between">
          <ShopTile icon={Tags} label="My products" detail={`${t?.activeListings ?? 0} for sale`} badge={attention.length || undefined} onPress={() => router.push('/reseller/listings')} />
          <ShopTile icon={Inbox} label="Requests" detail="Customers who want to buy" badge={t?.newRequests || undefined} onPress={() => router.push('/reseller/requests')} />
          <ShopTile icon={BookOpen} label="My sales" detail="Sales, profit & debts" onPress={() => router.push('/reseller/sales')} />
          <ShopTile icon={Share2} label="My page" detail="What customers see" onPress={() => router.push(`/r/${me.slug}`)} />
        </View>
      </View>
    </ScrollView>
  );
}
