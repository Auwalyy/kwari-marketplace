import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { Pressable, Switch, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ImagePlus, X } from 'lucide-react-native';
import { UPLOAD_LIMITS } from '@kkdm/shared';
import { TextField, type TextFieldProps, Chip } from './primitives';
import { toast } from './overlays';
import { colors } from '@/constants/theme';

/** react-hook-form bound text field. Errors come from the zod resolver. */
export function FormField<T extends FieldValues>({ control, name, transform, ...props }: { control: Control<T>; name: FieldPath<T>; transform?: { in?: (v: any) => string; out?: (t: string) => any } } & TextFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...props}
          value={transform?.in ? transform.in(field.value) : field.value == null ? '' : String(field.value)}
          onChangeText={(t) => field.onChange(transform?.out ? transform.out(t) : t)}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

export function SwitchRow({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View className="mb-3 flex-row items-center rounded-xl border border-line bg-white px-4 py-3">
      <View className="mr-3 flex-1">
        <Text className="text-base font-medium text-ink-900">{label}</Text>
        {description ? <Text className="mt-0.5 text-xs text-ink-500">{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.brandMid, false: colors.line }} thumbColor={colors.white} />
    </View>
  );
}

export function ChoiceChips<T extends string>({ label, options, value, onChange, multiple }: { label?: string; options: { value: T; label: string }[]; value: T | T[] | undefined; onChange: (v: any) => void; multiple?: boolean }) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <View className="mb-3">
      {label ? <Text className="mb-1.5 text-sm font-medium text-ink-700">{label}</Text> : null}
      <View className="flex-row flex-wrap">
        {options.map((o) => (
          <Chip
            key={o.value}
            label={o.label}
            selected={selected(o.value)}
            onPress={() => {
              if (!multiple) return onChange(value === o.value ? undefined : o.value);
              const arr = Array.isArray(value) ? value : [];
              onChange(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value]);
            }}
          />
        ))}
      </View>
    </View>
  );
}

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

/**
 * Picks images from the camera or gallery with optional cropping. Files over the upload limit are
 * rejected client-side; the server still validates and re-encodes every upload.
 */
export async function pickImages(source: 'camera' | 'library', opts: { multiple?: boolean; crop?: boolean; limit?: number } = {}): Promise<PickedImage[]> {
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    toast.error(source === 'camera' ? 'Camera permission is needed to take a photo.' : 'Photo library permission is needed to choose a photo.');
    return [];
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: !!opts.crop && !opts.multiple,
    aspect: opts.crop ? [1, 1] : undefined,
    allowsMultipleSelection: !!opts.multiple,
    selectionLimit: opts.limit ?? (opts.multiple ? UPLOAD_LIMITS.maxImagesPerProduct : 1),
    exif: false,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  const picked: PickedImage[] = [];
  for (const a of result.assets) {
    if (a.fileSize && a.fileSize > UPLOAD_LIMITS.maxImageBytes) {
      toast.error('That image is larger than 8 MB. Choose a smaller one.');
      continue;
    }
    picked.push({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' });
  }
  return picked;
}

export function ImagePickerRow({ images, onAdd, onRemove, max = UPLOAD_LIMITS.maxImagesPerProduct }: { images: { key: string; uri: string }[]; onAdd: (source: 'camera' | 'library') => void; onRemove?: (key: string) => void; max?: number }) {
  return (
    <View className="mb-4 flex-row flex-wrap">
      {images.map((img) => (
        <View key={img.key} className="mb-2 mr-2 h-24 w-24 overflow-hidden rounded-xl border border-line">
          <Image source={{ uri: img.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          {onRemove ? (
            <Pressable onPress={() => onRemove(img.key)} className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60" accessibilityLabel="Remove image">
              <X size={14} color={colors.white} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {images.length < max ? (
        <>
          <Pressable onPress={() => onAdd('camera')} className="mb-2 mr-2 h-24 w-24 items-center justify-center rounded-xl border border-dashed border-brand-300 bg-brand-50" accessibilityLabel="Take a photo">
            <Camera size={22} color={colors.brand} />
            <Text className="mt-1 text-xs text-brand-700">Camera</Text>
          </Pressable>
          <Pressable onPress={() => onAdd('library')} className="mb-2 mr-2 h-24 w-24 items-center justify-center rounded-xl border border-dashed border-brand-300 bg-brand-50" accessibilityLabel="Choose from gallery">
            <ImagePlus size={22} color={colors.brand} />
            <Text className="mt-1 text-xs text-brand-700">Gallery</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
