import { describe, expect, it } from 'vitest';
import { api, useTestDatabase } from './helpers';
import { Market } from '../src/modules/markets/market.models';
import { Category } from '../src/modules/products/product.models';
import { CATEGORY_DEFS, ensureReferenceData } from '../src/scripts/reference-data';

describe('production reference data setup', () => {
  useTestDatabase();

  it('creates the market and categories once and never touches existing records', async () => {
    const first = await ensureReferenceData();
    expect(first.createdCategories).toBe(CATEGORY_DEFS.length);
    await Category.updateOne({ slug: 'lace' }, { $set: { name: 'French & Swiss Lace' } });

    const second = await ensureReferenceData();
    expect(second.createdCategories).toBe(0);
    expect(String(second.market._id)).toBe(String(first.market._id));
    expect(await Market.countDocuments()).toBe(1);
    expect(await Category.countDocuments()).toBe(CATEGORY_DEFS.length);
    expect((await Category.findOne({ slug: 'lace' }))!.name).toBe('French & Swiss Lace');

    const res = await api().get('/api/v1/categories');
    expect(res.body.data).toHaveLength(CATEGORY_DEFS.length);
  });
});
