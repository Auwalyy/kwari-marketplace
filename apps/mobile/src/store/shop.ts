import { create } from 'zustand';

/** Which of the user's shops the "My shop" tab shows (people can own one shop and work in another). */
export const useSelectedShop = create<{ shopId: string | null; select: (shopId: string) => void }>((set) => ({
  shopId: null,
  select: (shopId) => set({ shopId }),
}));
