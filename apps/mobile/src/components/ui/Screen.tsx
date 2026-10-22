import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/constants/theme';
import { cx } from './primitives';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
  children: ReactNode;
  /** Wrap content in a ScrollView (default true). Use false for screens that render their own list. */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  padded?: boolean;
  keyboard?: boolean;
}

/** Standard screen: safe areas, header with back button, optional pull-to-refresh, keyboard-aware. */
export function Screen({ title, subtitle, back = true, right, children, scroll = true, refreshing, onRefresh, footer, padded = true, keyboard = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={{ paddingBottom: footer ? 16 : insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} /> : undefined}
    >
      <View className={cx(padded && 'px-4 pt-2')}>{children}</View>
    </ScrollView>
  ) : (
    <View className={cx('flex-1', padded && 'px-4')}>{children}</View>
  );
  const body = (
    <>
      {content}
      {footer ? (
        <View className="border-t border-line bg-white px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {footer}
        </View>
      ) : null}
    </>
  );
  return (
    <View className="flex-1 bg-cream-100" style={{ paddingTop: insets.top }}>
      {title !== undefined ? <Header title={title} subtitle={subtitle} back={back} right={right} /> : null}
      {keyboard ? (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

export function Header({ title, subtitle, back = true, right }: { title: string; subtitle?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View className="min-h-[56px] flex-row items-center border-b border-line bg-cream-100 px-2">
      {back && router.canGoBack() ? (
        <Pressable onPress={() => router.back()} hitSlop={10} className="h-10 w-10 items-center justify-center rounded-full active:bg-cream-200" accessibilityRole="button" accessibilityLabel="Go back">
          <ChevronLeft size={26} color={colors.ink} />
        </Pressable>
      ) : (
        <View className="w-2" />
      )}
      <View className="flex-1 px-1">
        <Text numberOfLines={1} className="text-lg font-bold text-ink-900">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-xs text-ink-500">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View className="flex-row items-center">{right}</View> : null}
    </View>
  );
}
