import { useRef, useState } from 'react';
import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Home, KeyRound, ShoppingBag, Users, type LucideIcon } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/constants/theme';
import { prefs } from '@/lib/secureStorage';

const SLIDES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShoppingBag, title: 'Kantin Kwari in your pocket', body: 'Browse real shops from the Kantin Kwari market in Kano — every shop is linked to its house and shop number in the market.' },
  { icon: Camera, title: 'Find fabric by photo', body: 'Snap or upload a fabric and see visually similar fabrics from market shops. No need to know the fabric’s name.' },
  { icon: Users, title: 'Customers', body: 'Browse without an account. Create one to chat with sellers, request wholesale quotations, place orders and track delivery or pickup.' },
  { icon: KeyRound, title: 'Shop owners', body: 'Get an invitation code from your house head to register your physical shop. Your house head approves it before it appears in the directory.' },
  { icon: Home, title: 'House heads & workers', body: 'House heads manage their house and invite shops. Shop owners invite workers with only the permissions they need.' },
];

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);
  const finish = async (to: string) => {
    await prefs.set('onboardingSeen', true);
    router.replace(to as never);
  };
  const last = index === SLIDES.length - 1;
  return (
    <View className="flex-1 bg-brand-800" style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}>
      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.title}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={{ width }} className="flex-1 items-center justify-center px-8">
            <View className="mb-8 h-28 w-28 items-center justify-center rounded-full bg-brand-700">
              <item.icon size={52} color={colors.gold} />
            </View>
            <Text className="text-center text-3xl font-bold text-white">{item.title}</Text>
            <Text className="mt-4 text-center text-base leading-6 text-brand-100">{item.body}</Text>
          </View>
        )}
      />
      <View className="mb-6 flex-row justify-center">
        {SLIDES.map((s, i) => (
          <View key={s.title} className={`mx-1 h-2 rounded-full ${i === index ? 'w-6 bg-gold-500' : 'w-2 bg-brand-600'}`} />
        ))}
      </View>
      <View className="px-6">
        {last ? (
          <>
            <Button title="Create an account" onPress={() => finish('/(auth)/register')} variant="accent" className="mb-3" fullWidth size="lg" />
            <Button title="Sign in" variant="outline" onPress={() => finish('/(auth)/login')} className="mb-3" fullWidth />
            <LightLink label="Browse as a guest" onPress={() => finish('/(tabs)')} />
          </>
        ) : (
          <View className="flex-row">
            <View className="mr-3 flex-1 justify-center">
              <LightLink label="Skip" onPress={() => finish('/(tabs)')} />
            </View>
            <Button title="Next" onPress={() => list.current?.scrollToIndex({ index: index + 1 })} variant="accent" className="flex-1" />
          </View>
        )}
      </View>
    </View>
  );
}

function LightLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="h-12 items-center justify-center rounded-xl active:bg-brand-700">
      <Text className="text-base font-semibold text-brand-100">{label}</Text>
    </Pressable>
  );
}
