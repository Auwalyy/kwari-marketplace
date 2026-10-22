import { forwardRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps, type ViewProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors } from '@/constants/theme';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* Typography ------------------------------------------------------------------------------------ */

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return <Text className={cx('text-2xl font-bold text-ink-900', className)}>{children}</Text>;
}
export function Heading({ children, className, numberOfLines }: { children: ReactNode; className?: string; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} className={cx('text-lg font-semibold text-ink-900', className)}>
      {children}
    </Text>
  );
}
export function Body({ children, className, numberOfLines }: { children: ReactNode; className?: string; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} className={cx('text-base text-ink-700', className)}>
      {children}
    </Text>
  );
}
export function Caption({ children, className, numberOfLines }: { children: ReactNode; className?: string; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} className={cx('text-sm text-ink-500', className)}>
      {children}
    </Text>
  );
}

/* Buttons --------------------------------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
const variantClass: Record<Variant, { box: string; text: string; icon: string }> = {
  primary: { box: 'bg-brand-700 active:bg-brand-800', text: 'text-white', icon: colors.white },
  secondary: { box: 'bg-brand-50 active:bg-brand-100', text: 'text-brand-800', icon: colors.brand },
  outline: { box: 'border border-line bg-white active:bg-cream-100', text: 'text-ink-800', icon: colors.ink },
  ghost: { box: 'bg-transparent active:bg-cream-200', text: 'text-brand-700', icon: colors.brand },
  danger: { box: 'bg-danger-500 active:bg-danger-700', text: 'text-white', icon: colors.white },
};

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: LucideIcon;
  className?: string;
  fullWidth?: boolean;
}

export function Button({ title, variant = 'primary', size = 'md', loading, icon: Icon, className, fullWidth, disabled, ...rest }: ButtonProps) {
  const v = variantClass[variant];
  const sizing = size === 'sm' ? 'h-9 px-3' : size === 'lg' ? 'h-14 px-6' : 'h-12 px-4';
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      className={cx('flex-row items-center justify-center rounded-xl', sizing, v.box, fullWidth && 'w-full', isDisabled && 'opacity-50', className)}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={v.icon} />
      ) : (
        <>
          {Icon ? <Icon size={size === 'sm' ? 16 : 18} color={v.icon} style={{ marginRight: 8 }} /> : null}
          <Text className={cx('font-semibold', size === 'sm' ? 'text-sm' : 'text-base', v.text)}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon: Icon, onPress, label, color = colors.ink, className, badge }: { icon: LucideIcon; onPress?: () => void; label: string; color?: string; className?: string; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} className={cx('h-10 w-10 items-center justify-center rounded-full active:bg-cream-200', className)}>
      <Icon size={22} color={color} />
      {badge ? (
        <View className="absolute right-0.5 top-0.5 min-w-[18px] items-center rounded-full bg-danger-500 px-1">
          <Text className="text-[10px] font-bold text-white">{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* Inputs ---------------------------------------------------------------------------------------- */

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  containerClassName?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ label, error, hint, icon: Icon, right, containerClassName, multiline, className, ...rest }, ref) {
  return (
    <View className={cx('mb-4', containerClassName)}>
      {label ? <Text className="mb-1.5 text-sm font-medium text-ink-700">{label}</Text> : null}
      <View className={cx('flex-row items-center rounded-xl border bg-white px-3', error ? 'border-danger-500' : 'border-line', multiline ? 'min-h-[96px] items-start py-2' : 'h-12')}>
        {Icon ? <Icon size={18} color={colors.inkFaint} style={{ marginRight: 8 }} /> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.inkFaint}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          accessibilityLabel={label}
          className={cx('flex-1 text-base text-ink-900', className)}
          {...rest}
        />
        {right}
      </View>
      {error ? <Text className="mt-1 text-sm text-danger-500">{error}</Text> : hint ? <Text className="mt-1 text-xs text-ink-500">{hint}</Text> : null}
    </View>
  );
});

/* Layout ---------------------------------------------------------------------------------------- */

export function Card({ children, className, onPress, ...rest }: ViewProps & { children: ReactNode; className?: string; onPress?: () => void }) {
  const box = cx('rounded-2xl border border-line bg-white p-4', className);
  if (onPress) {
    return (
      <Pressable onPress={onPress} className={cx(box, 'active:bg-cream-50')} accessibilityRole="button">
        {children}
      </Pressable>
    );
  }
  return (
    <View className={box} {...rest}>
      {children}
    </View>
  );
}

export function Divider({ className }: { className?: string }) {
  return <View className={cx('my-3 h-px bg-line', className)} />;
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={cx('flex-row items-center', className)}>{children}</View>;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View className="mb-3 mt-6 flex-row items-center justify-between">
      <Heading>{title}</Heading>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text className="font-semibold text-brand-700">{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function KeyValue({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <View className="flex-row items-start justify-between py-1.5">
      <Text className="mr-4 text-sm text-ink-500">{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text className={cx('flex-1 text-right text-sm', strong ? 'font-bold text-ink-900' : 'text-ink-800')}>{value}</Text>
      ) : (
        <View className="flex-1 items-end">{value}</View>
      )}
    </View>
  );
}

export function ListItem({ title, subtitle, icon: Icon, right, onPress, danger }: { title: string; subtitle?: string; icon?: LucideIcon; right?: ReactNode; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="flex-row items-center border-b border-line bg-white px-4 py-3.5 active:bg-cream-50" accessibilityRole={onPress ? 'button' : undefined}>
      {Icon ? (
        <View className={cx('mr-3 h-9 w-9 items-center justify-center rounded-full', danger ? 'bg-danger-50' : 'bg-brand-50')}>
          <Icon size={18} color={danger ? colors.danger : colors.brand} />
        </View>
      ) : null}
      <View className="flex-1">
        <Text className={cx('text-base font-medium', danger ? 'text-danger-500' : 'text-ink-900')}>{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-sm text-ink-500">{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon: Icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: LucideIcon }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      className={cx('mb-2 mr-2 flex-row items-center rounded-full border px-3.5 py-2', selected ? 'border-brand-700 bg-brand-700' : 'border-line bg-white')}
    >
      {Icon ? <Icon size={14} color={selected ? colors.white : colors.ink} style={{ marginRight: 6 }} /> : null}
      <Text className={cx('text-sm font-medium', selected ? 'text-white' : 'text-ink-800')}>{label}</Text>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View className="mb-4 flex-row rounded-xl bg-cream-200 p-1">
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} className={cx('flex-1 items-center rounded-lg py-2', value === o.value && 'bg-white')} accessibilityRole="tab" accessibilityState={{ selected: value === o.value }}>
          <Text className={cx('text-sm font-semibold', value === o.value ? 'text-brand-800' : 'text-ink-500')}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name
    .replace('[DEMO]', '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-brand-100">
      <Text className="font-bold text-brand-800" style={{ fontSize: size * 0.38 }}>
        {initials || '?'}
      </Text>
    </View>
  );
}

export function QuantityStepper({ value, onChange, step = 1, min = 0.01, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const set = (v: number) => onChange(Math.max(min, max != null ? Math.min(max, Math.round(v * 100) / 100) : Math.round(v * 100) / 100));
  return (
    <View className="flex-row items-center rounded-xl border border-line bg-white">
      <Pressable onPress={() => set(value - step)} className="h-10 w-10 items-center justify-center" accessibilityLabel="Decrease quantity">
        <Text className="text-xl text-ink-800">−</Text>
      </Pressable>
      <TextInput
        value={String(value)}
        onChangeText={(t) => {
          const n = Number(t.replace(',', '.'));
          if (Number.isFinite(n) && n > 0) set(n);
        }}
        keyboardType="decimal-pad"
        className="w-16 text-center text-base font-semibold text-ink-900"
        accessibilityLabel="Quantity"
      />
      <Pressable onPress={() => set(value + step)} className="h-10 w-10 items-center justify-center" accessibilityLabel="Increase quantity">
        <Text className="text-xl text-ink-800">+</Text>
      </Pressable>
    </View>
  );
}
