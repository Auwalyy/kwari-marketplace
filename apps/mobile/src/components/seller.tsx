import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Info, PackageX, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react-native';
import type { ShopDto, ShopInsightDto, ShopPermission } from '@kkdm/shared';
import { colors } from '@/constants/theme';
import { api } from '@/lib/api';
import { cx } from '@/components/ui/primitives';

export type StaffShop = ShopDto & { viewerRole: 'owner' | 'worker'; viewerPermissions: ShopPermission[] };

/** The shop as staff see it, plus what this person may do. The server checks every action again. */
export function useStaffShop(shopId: string) {
  const q = useQuery({ queryKey: ['shop', shopId], queryFn: () => api.get<StaffShop>(`/shops/${shopId}`), enabled: !!shopId });
  const s = q.data;
  const can = (p: ShopPermission | 'owner') => !!s?.viewerRole && (s.viewerRole === 'owner' || (p !== 'owner' && s.viewerPermissions?.includes(p)));
  return { ...q, can, finance: can('finance.view'), isOwner: s?.viewerRole === 'owner' };
}

/** Where tapping a piece of advice takes the seller. */
export function openInsight(shopId: string, i: ShopInsightDto) {
  const base = `/seller/${shopId}`;
  switch (i.action) {
    case 'orders':
      return router.push(`${base}/orders` as never);
    case 'enquiries':
      return router.push(`${base}/enquiries` as never);
    case 'inventory':
      return router.push({ pathname: `${base}/inventory` as never, params: i.productId ? { productId: i.productId } : {} });
    case 'products':
      return router.push(`${base}/products` as never);
    case 'sales_owing':
      return router.push({ pathname: `${base}/sales` as never, params: { owing: '1' } });
    case 'product':
      return i.productId ? router.push(`${base}/product/${i.productId}` as never) : undefined;
    case 'books':
      return router.push(`${base}/books` as never);
  }
}

const TONE: Record<ShopInsightDto['severity'], { bar: string; bg: string; icon: LucideIcon; color: string }> = {
  urgent: { bar: 'bg-danger-500', bg: 'bg-danger-50', icon: AlertTriangle, color: colors.danger },
  warning: { bar: 'bg-warning-500', bg: 'bg-warning-50', icon: PackageX, color: colors.warning },
  info: { bar: 'bg-info-500', bg: 'bg-white', icon: Info, color: colors.info },
  good: { bar: 'bg-brand-500', bg: 'bg-brand-50', icon: TrendingUp, color: colors.brand },
};

export function InsightRow({ insight, shopId }: { insight: ShopInsightDto; shopId: string }) {
  const t = TONE[insight.severity];
  const Icon = insight.kind === 'best_seller' ? Sparkles : t.icon;
  return (
    <Pressable
      onPress={() => openInsight(shopId, insight)}
      disabled={!insight.action}
      className={cx('mb-2 flex-row overflow-hidden rounded-2xl border border-line active:opacity-80', t.bg)}
      accessibilityRole={insight.action ? 'button' : undefined}
    >
      <View className={cx('w-1.5', t.bar)} />
      <View className="flex-1 flex-row items-start p-3">
        <Icon size={18} color={t.color} style={{ marginTop: 1 }} />
        <View className="ml-2.5 flex-1">
          <Text className="text-sm font-bold text-ink-900">{insight.title}</Text>
          <Text className="mt-0.5 text-[13px] leading-5 text-ink-600">{insight.message}</Text>
        </View>
        {insight.action ? <ChevronRight size={18} color={colors.inkFaint} /> : null}
      </View>
    </Pressable>
  );
}

/** Big, obvious action button for the things a seller does many times a day. */
export function QuickAction({ icon: Icon, label, onPress, primary }: { icon: LucideIcon; label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={cx('mx-1 flex-1 items-center rounded-2xl px-1 py-3 active:opacity-80', primary ? 'bg-gold-500' : 'bg-white/10')}
    >
      <Icon size={24} color={primary ? colors.brandDark : colors.white} />
      <Text numberOfLines={2} className={cx('mt-1.5 text-center text-xs font-bold', primary ? 'text-brand-900' : 'text-white')}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A section of the shop, with an optional count that needs attention. */
export function ShopTile({ icon: Icon, label, detail, badge, onPress }: { icon: LucideIcon; label: string; detail?: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="mb-2.5 w-[48.5%] rounded-2xl border border-line bg-white p-3.5 active:bg-cream-50">
      <View className="flex-row items-start justify-between">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
          <Icon size={20} color={colors.brand} />
        </View>
        {badge ? (
          <View className="min-w-[22px] items-center rounded-full bg-danger-500 px-1.5 py-0.5">
            <Text className="text-xs font-bold text-white">{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text className="mt-2.5 text-base font-bold text-ink-900">{label}</Text>
      {detail ? (
        <Text numberOfLines={1} className="mt-0.5 text-xs text-ink-500">
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A labelled money figure. */
export function Figure({ label, value, hint, tone = 'default', big }: { label: string; value: string; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'light'; big?: boolean }) {
  const valueColor = tone === 'good' ? 'text-brand-700' : tone === 'bad' ? 'text-danger-500' : tone === 'light' ? 'text-white' : 'text-ink-900';
  return (
    <View className="mb-1">
      <Text className={cx('text-xs', tone === 'light' ? 'text-brand-100' : 'text-ink-500')}>{label}</Text>
      <Text className={cx('font-bold', big ? 'text-3xl' : 'text-lg', valueColor)}>{value}</Text>
      {typeof hint === 'string' ? <Text className={cx('text-[11px]', tone === 'light' ? 'text-brand-100' : 'text-ink-400')}>{hint}</Text> : hint}
    </View>
  );
}
