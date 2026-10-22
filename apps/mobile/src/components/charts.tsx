import { Text, View } from 'react-native';
import { formatNaira } from '@/lib/format';

/** Minimal bar chart for daily trends (no charting dependency). Values are kobo. */
export function BarTrend({ data, valueKey, label }: { data: { date: string; [k: string]: number | string }[]; valueKey: string; label: string }) {
  const values = data.map((d) => Number(d[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  if (!data.length) return <Text className="text-sm text-ink-500">No activity in this period.</Text>;
  return (
    <View accessibilityLabel={`${label}: total ${formatNaira(total)}`}>
      <View className="h-28 flex-row items-end">
        {data.map((d) => (
          <View key={d.date} className="mx-px flex-1 items-center justify-end">
            <View className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(4, ((Number(d[valueKey]) || 0) / max) * 100)}%`, opacity: Number(d[valueKey]) ? 1 : 0.2 }} />
          </View>
        ))}
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-[10px] text-ink-400">{data[0].date.slice(5)}</Text>
        <Text className="text-[10px] text-ink-400">{data[data.length - 1].date.slice(5)}</Text>
      </View>
    </View>
  );
}

export function StatTile({ label, value, hint, onPress }: { label: string; value: string; hint?: string; onPress?: () => void }) {
  return (
    <View className="mb-2 w-[48.5%] rounded-2xl border border-line bg-white p-3" onTouchEnd={onPress}>
      <Text className="text-xs text-ink-500">{label}</Text>
      <Text className="mt-1 text-lg font-bold text-ink-900">{value}</Text>
      {hint ? <Text className="mt-0.5 text-[11px] text-ink-400">{hint}</Text> : null}
    </View>
  );
}
