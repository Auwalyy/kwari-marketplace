import type { Types } from 'mongoose';
import { Market } from '../modules/markets/market.models';
import { Category } from '../modules/products/product.models';

/** The market the platform launches with. Shared by the production setup script and the dev seed. */
export const KANTIN_KWARI = {
  name: 'Kantin Kwari',
  slug: 'kantin-kwari',
  description: 'Kantin Kwari textile market, Kano — one of the largest textile markets in West Africa.',
  region: 'Kano',
  city: 'Kano',
  country: 'NG',
  usesSections: true,
  location: { lat: 12.0033, lng: 8.5167 },
};

/** Fabric categories: [slug, name, Lucide icon name]. */
export const CATEGORY_DEFS = [
  ['bazin', 'Bazin Riche & Damask', 'sparkles'],
  ['ankara-wax', 'Ankara & Wax Prints', 'shirt'],
  ['lace', 'Lace', 'flower'],
  ['guinea-brocade', 'Guinea Brocade & Shadda', 'gem'],
  ['atiku', 'Atiku & Senator', 'briefcase'],
  ['aso-oke', 'Aso Oke', 'crown'],
  ['plain', 'Plain & Shirting', 'layers'],
  ['accessories', 'Gele, Caps & Accessories', 'tag'],
] as const;

/**
 * Creates the launch market and categories when they don't exist yet. Existing records are left exactly
 * as they are (an admin may have renamed or reordered them), so this is safe to run again.
 */
export async function ensureReferenceData(createdBy?: Types.ObjectId) {
  const market = (await Market.findOne({ slug: KANTIN_KWARI.slug })) ?? (await Market.create({ ...KANTIN_KWARI, createdBy }));
  const categories: Record<string, Types.ObjectId> = {};
  let created = 0;
  for (const [i, [slug, name, iconName]] of CATEGORY_DEFS.entries()) {
    let c = await Category.findOne({ slug });
    if (!c) {
      c = await Category.create({ slug, name, iconName, sortOrder: i });
      created++;
    }
    categories[slug] = c._id;
  }
  return { market, categories, createdCategories: created };
}
