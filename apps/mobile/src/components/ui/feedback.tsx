import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { AlertTriangle, Inbox, WifiOff, type LucideIcon } from 'lucide-react-native';
import { Button, cx } from './primitives';
import { colors } from '@/constants/theme';
import { ApiError } from '@/lib/api';

export function EmptyState({ icon: Icon = Inbox, title, message, action, onAction }: { icon?: LucideIcon; title: string; message?: string; action?: string; onAction?: () => void }) {
  return (
    <View className="items-center px-8 py-14">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-brand-50">
        <Icon size={28} color={colors.brand} />
      </View>
      <Text className="text-center text-lg font-semibold text-ink-900">{title}</Text>
      {message ? <Text className="mt-1.5 text-center text-sm leading-5 text-ink-500">{message}</Text> : null}
      {action && onAction ? <Button title={action} onPress={onAction} variant="secondary" className="mt-5" /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.isNetwork;
  const message = e?.message ?? 'Something went wrong.';
  if (compact) {
    return (
      <View className="flex-row items-center rounded-xl bg-danger-50 p-3">
        <AlertTriangle size={16} color={colors.danger} />
        <Text className="ml-2 flex-1 text-sm text-danger-700">{message}</Text>
        {onRetry ? (
          <Text onPress={onRetry} className="ml-2 font-semibold text-danger-700">
            Retry
          </Text>
        ) : null}
      </View>
    );
  }
  return <EmptyState icon={offline ? WifiOff : AlertTriangle} title={offline ? 'You are offline' : 'Could not load this'} message={message} action={onRetry ? 'Try again' : undefined} onAction={onRetry} />;
}

export function LoadingView({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center py-16">
      <ActivityIndicator color={colors.brand} size="large" />
      {label ? <Text className="mt-3 text-sm text-ink-500">{label}</Text> : null}
    </View>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: object }) {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[animated, style]} className={cx('rounded-xl bg-cream-300', className)} />;
}

export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="flex-row flex-wrap justify-between">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className="mb-4 w-[48%]">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-1.5 h-4 w-1/2" />
        </View>
      ))}
    </View>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View className="p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="mb-4 flex-row items-center">
          <Skeleton className="h-12 w-12" />
          <View className="ml-3 flex-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/3" />
          </View>
        </View>
      ))}
    </View>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode }) {
  const toneClass = { info: 'bg-info-50 border-info-500/20', warning: 'bg-warning-50 border-warning-500/30', danger: 'bg-danger-50 border-danger-500/20', success: 'bg-brand-50 border-brand-300' }[tone];
  return (
    <View className={cx('mb-4 rounded-xl border p-3', toneClass)}>
      {title ? <Text className="mb-0.5 font-semibold text-ink-900">{title}</Text> : null}
      {typeof children === 'string' ? <Text className="text-sm leading-5 text-ink-700">{children}</Text> : children}
    </View>
  );
}
