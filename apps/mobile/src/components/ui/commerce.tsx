import { Text, View } from 'react-native';
import { BadgeCheck, Clock, MapPin, ShieldAlert } from 'lucide-react-native';
import {
  ORDER_STATUS_LABELS,
  type LocationBreadcrumb,
  type MeasurementUnit,
  type OrderStatus,
  type PaymentStatus,
  type StockStatus,
  type VerificationStatus,
} from '@kkdm/shared';
import { colors } from '@/constants/theme';
import { formatNaira, unitLabel } from '@/lib/format';
import { cx } from './primitives';

export function Badge({ label, tone = 'neutral', className }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold'; className?: string }) {
  const cls = {
    neutral: 'bg-cream-200 text-ink-700',
    success: 'bg-brand-50 text-brand-800',
    warning: 'bg-warning-50 text-warning-500',
    danger: 'bg-danger-50 text-danger-700',
    info: 'bg-info-50 text-info-500',
    gold: 'bg-gold-100 text-gold-700',
  }[tone];
  const [bg, fg] = cls.split(' ');
  return (
    <View className={cx('self-start rounded-full px-2.5 py-0.5', bg, className)}>
      <Text className={cx('text-xs font-semibold', fg)}>{label}</Text>
    </View>
  );
}

/** Verification is only shown as "Verified" after admin review — an invitation code is not proof. */
export function VerificationBadge({ status, compact }: { status: VerificationStatus; compact?: boolean }) {
  if (status === 'verified') {
    return (
      <View className="flex-row items-center" accessibilityLabel="Verified shop">
        <BadgeCheck size={compact ? 14 : 16} color={colors.brandMid} />
        {!compact ? <Text className="ml-1 text-xs font-semibold text-brand-600">Verified</Text> : null}
      </View>
    );
  }
  if (compact) return null;
  if (status === 'pending') return <Badge label="Verification pending" tone="warning" />;
  if (status === 'rejected') return <Badge label="Not verified" tone="danger" />;
  return <Badge label="Not yet verified" tone="neutral" />;
}

export function SponsoredLabel() {
  return <Badge label="Sponsored" tone="gold" />;
}

export function PriceLabel({ kobo, unit, size = 'md', className }: { kobo: number; unit?: MeasurementUnit; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <Text className={cx('font-bold text-ink-900', text, className)}>
      {formatNaira(kobo)}
      {unit ? <Text className="text-sm font-normal text-ink-500"> / {unitLabel(unit)}</Text> : null}
    </Text>
  );
}

export function WholesaleLine({ priceKobo, minQty, unit }: { priceKobo?: number | null; minQty?: number | null; unit: MeasurementUnit }) {
  if (priceKobo == null || minQty == null) return null;
  return (
    <Text className="text-xs text-brand-700">
      Wholesale {formatNaira(priceKobo)} from {minQty} {unitLabel(unit, minQty)}
    </Text>
  );
}

export function StockIndicator({ status }: { status: StockStatus }) {
  const map = { in_stock: ['In stock', 'success'], low_stock: ['Low stock', 'warning'], out_of_stock: ['Out of stock', 'danger'] } as const;
  const [label, tone] = map[status];
  return <Badge label={label} tone={tone} />;
}

export function LocationBreadcrumbView({ breadcrumb, compact }: { breadcrumb?: LocationBreadcrumb | null; compact?: boolean }) {
  if (!breadcrumb) return null;
  return (
    <View className="flex-row items-center" accessibilityLabel={`Location: ${breadcrumb.label}`}>
      <MapPin size={compact ? 12 : 14} color={colors.inkMuted} />
      <Text numberOfLines={compact ? 1 : 2} className={cx('ml-1 flex-1 text-ink-500', compact ? 'text-xs' : 'text-sm')}>
        {breadcrumb.label}
      </Text>
    </View>
  );
}

const ORDER_TONE: Partial<Record<OrderStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'>> = {
  pending_acceptance: 'warning',
  accepted: 'info',
  processing: 'info',
  ready: 'success',
  dispatched: 'info',
  delivered: 'success',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  refund_pending: 'warning',
  refunded: 'neutral',
  disputed: 'danger',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge label={ORDER_STATUS_LABELS[status]} tone={ORDER_TONE[status] ?? 'neutral'} />;
}

const PAYMENT_LABEL: Record<PaymentStatus, [string, 'success' | 'warning' | 'danger' | 'info' | 'neutral']> = {
  unpaid: ['Unpaid', 'neutral'],
  pending: ['Payment pending', 'warning'],
  paid: ['Paid · verified', 'success'],
  seller_confirmed: ['Paid · confirmed by seller', 'info'],
  failed: ['Payment failed', 'danger'],
  cancelled: ['Payment cancelled', 'neutral'],
  refund_pending: ['Refund pending', 'warning'],
  refunded: ['Refunded', 'neutral'],
};

/** Gateway-verified and seller-confirmed payments are always labelled differently. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const [label, tone] = PAYMENT_LABEL[status];
  return <Badge label={label} tone={tone} />;
}

export function PendingBanner({ text }: { text: string }) {
  return (
    <View className="mb-4 flex-row items-center rounded-xl bg-warning-50 p-3">
      <Clock size={16} color={colors.warning} />
      <Text className="ml-2 flex-1 text-sm text-ink-700">{text}</Text>
    </View>
  );
}

export function RiskBanner({ text }: { text: string }) {
  return (
    <View className="mb-4 flex-row items-center rounded-xl bg-danger-50 p-3">
      <ShieldAlert size={16} color={colors.danger} />
      <Text className="ml-2 flex-1 text-sm text-danger-700">{text}</Text>
    </View>
  );
}

export function Rating({ value, count }: { value: number; count: number }) {
  if (!count) return <Text className="text-xs text-ink-400">No reviews yet</Text>;
  return (
    <Text className="text-xs text-ink-600">
      <Text className="text-gold-500">★</Text> {value.toFixed(1)} <Text className="text-ink-400">({count})</Text>
    </Text>
  );
}
