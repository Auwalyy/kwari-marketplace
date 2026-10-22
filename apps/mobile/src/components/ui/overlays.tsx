import { createContext, forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { toast as sonner } from 'sonner-native';
import { Button } from './primitives';
import { colors } from '@/constants/theme';
import { toApiError } from '@/lib/api';

/* Toasts ---------------------------------------------------------------------------------------- */

export const toast = {
  success: (message: string) => sonner.success(message),
  error: (message: string) => sonner.error(message),
  info: (message: string) => sonner(message),
  /** Shows the server's message for an API error (never raw stack traces). */
  apiError: (err: unknown, fallback = 'Something went wrong') => sonner.error(toApiError(err).message || fallback),
};

/* Confirmation dialog --------------------------------------------------------------------------- */

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Ask for a reason (e.g. rejecting or cancelling). Resolves with the text. */
  reason?: { placeholder: string; required?: boolean; minLength?: number };
}
type ConfirmResult = { confirmed: boolean; reason?: string };
type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn>(async () => ({ confirmed: false }));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise((resolve) => {
        setReason('');
        setState({ ...opts, resolve });
      }),
    [],
  );
  const close = (r: ConfirmResult) => {
    state?.resolve(r);
    setState(null);
  };
  const reasonInvalid = !!state?.reason?.required && reason.trim().length < (state.reason.minLength ?? 3);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => close({ confirmed: false })}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={() => close({ confirmed: false })}>
          <Pressable className="w-full max-w-md rounded-2xl bg-white p-5" onPress={() => undefined}>
            <Text className="text-lg font-bold text-ink-900">{state?.title}</Text>
            {state?.message ? <Text className="mt-2 text-sm leading-5 text-ink-600">{state.message}</Text> : null}
            {state?.reason ? (
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder={state.reason.placeholder}
                placeholderTextColor={colors.inkFaint}
                multiline
                className="mt-4 min-h-[80px] rounded-xl border border-line p-3 text-base text-ink-900"
                textAlignVertical="top"
              />
            ) : null}
            <View className="mt-5 flex-row justify-end">
              <Button title={state?.cancelLabel ?? 'Cancel'} variant="ghost" onPress={() => close({ confirmed: false })} className="mr-2" />
              <Button
                title={state?.confirmLabel ?? 'Confirm'}
                variant={state?.destructive ? 'danger' : 'primary'}
                disabled={reasonInvalid}
                onPress={() => close({ confirmed: true, reason: reason.trim() || undefined })}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

/* Bottom sheet ---------------------------------------------------------------------------------- */

export interface SheetHandle {
  open: () => void;
  close: () => void;
}

/** Bottom sheet for filters and action menus (gorhom/bottom-sheet). */
export const Sheet = forwardRef<SheetHandle, { title?: string; children: ReactNode; footer?: ReactNode; snapPoints?: (string | number)[] }>(function Sheet({ title, children, footer, snapPoints }, ref) {
  const modal = useRef<BottomSheetModal>(null);
  useImperativeHandle(ref, () => ({ open: () => modal.current?.present(), close: () => modal.current?.dismiss() }), []);
  const points = useMemo(() => snapPoints ?? ['75%'], [snapPoints]);
  return (
    <BottomSheetModal
      ref={modal}
      snapPoints={points}
      enableDynamicSizing={false}
      backdropComponent={(p) => <BottomSheetBackdrop {...p} appearsOnIndex={0} disappearsOnIndex={-1} />}
      backgroundStyle={{ backgroundColor: colors.creamLight }}
    >
      {title ? <Text className="px-5 pb-2 text-lg font-bold text-ink-900">{title}</Text> : null}
      <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>{children}</BottomSheetScrollView>
      {footer ? <View className="border-t border-line px-5 pb-6 pt-3">{footer}</View> : null}
    </BottomSheetModal>
  );
});

/** Simple action sheet built on Sheet. */
export const ActionSheet = forwardRef<SheetHandle, { title?: string; actions: { label: string; onPress: () => void; destructive?: boolean }[] }>(function ActionSheet({ title, actions }, ref) {
  const inner = useRef<SheetHandle>(null);
  useImperativeHandle(ref, () => ({ open: () => inner.current?.open(), close: () => inner.current?.close() }), []);
  return (
    <Sheet ref={inner} title={title} snapPoints={[Math.min(120 + actions.length * 56, 520)]}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => {
            inner.current?.close();
            a.onPress();
          }}
          className="border-b border-line py-4"
        >
          <Text className={a.destructive ? 'text-base font-semibold text-danger-500' : 'text-base font-medium text-ink-900'}>{a.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
});
