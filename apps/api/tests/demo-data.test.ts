import { describe, expect, it } from 'vitest';
import { api, auth, createActiveShop, createMarketFixture, createPublishedProduct, registerUser, useTestDatabase } from './helpers';
import { House } from '../src/modules/markets/market.models';
import { Cart } from '../src/modules/orders/order.models';
import { Favorite, Product } from '../src/modules/products/product.models';
import { Shop } from '../src/modules/shops/shop.models';
import { User } from '../src/modules/users/user.model';
import { DEMO_HOUSE_MARKER, removeDemoData } from '../src/scripts/demo-data';

describe('demo data removal', () => {
  useTestDatabase();

  it('removes demo shops, products and accounts but keeps real sellers, customers and houses', async () => {
    const fx = await createMarketFixture();
    // A demo house (seed marker, demo head) that a real seller has also joined.
    await User.updateOne({ _id: fx.head.id }, { $set: { email: 'head1@demo.kantinkwari.test' } });
    await House.updateOne({ _id: fx.houseId }, { $set: { addressDescription: `Middle of Lace Row ${DEMO_HOUSE_MARKER}` } });
    // An empty demo house.
    await House.updateOne({ _id: fx.directHouseId }, { $set: { addressDescription: `By the main gate ${DEMO_HOUSE_MARKER}` } });

    const demoOwner = await registerUser('Demo Owner');
    await User.updateOne({ _id: demoOwner.id }, { $set: { email: 'owner1@demo.kantinkwari.test' } });
    const demo = await createActiveShop(fx, demoOwner);
    const demoProduct = await createPublishedProduct(demoOwner, demo.shopId, fx.categoryId);

    const real = await createActiveShop(fx);
    const realProduct = await createPublishedProduct(real.owner, real.shopId, fx.categoryId, { name: 'Real Lace' });

    // A real customer who put both in their cart and saved the demo shop.
    const customer = await registerUser('Real Customer');
    for (const id of [demoProduct.id, realProduct.id]) {
      const r = await api().post('/api/v1/cart/items').set(auth(customer)).send({ productId: id, quantity: 2 });
      expect(r.status).toBe(201);
    }
    await Favorite.create({ userId: customer.id, targetType: 'shop', targetId: demo.shopId });

    const preview = await removeDemoData({ dryRun: true });
    expect(preview.deleted).toMatchObject({ shops: 1, products: 1, accounts: 2, favourites: 1, houses: 1 });
    expect(preview.cartsCleaned).toBe(1);
    expect(await Product.exists({ _id: demoProduct.id })).toBeTruthy(); // preview changes nothing

    const result = await removeDemoData();
    expect(result.deleted).toMatchObject({ shops: 1, products: 1, accounts: 2, houses: 1 });
    expect(result.filesDeleted).toBeGreaterThan(0);

    expect(await Shop.exists({ _id: demo.shopId })).toBeNull();
    expect(await Product.exists({ _id: demoProduct.id })).toBeNull();
    expect(await User.exists({ email: /@demo\.kantinkwari\.test$/ })).toBeNull();
    expect(await Favorite.countDocuments({ userId: customer.id })).toBe(0);

    // Real data survives: the seller, their product, the customer and the cart's real item.
    expect(await Shop.exists({ _id: real.shopId })).toBeTruthy();
    expect(await Product.exists({ _id: realProduct.id })).toBeTruthy();
    expect(await User.exists({ _id: customer.id })).toBeTruthy();
    const cart = await Cart.findOne({ userId: customer.id }).lean();
    expect(cart!.items.map((i) => String(i.productId))).toEqual([realProduct.id]);

    // The shared demo house stays for the real shop, without its demo head; the empty one is gone.
    const kept = await House.findById(fx.houseId).lean();
    expect(kept!.headUserId).toBeNull();
    expect(await House.exists({ _id: fx.directHouseId })).toBeNull();

    // Running it again finds nothing.
    expect((await removeDemoData()).deleted).toEqual({});
  });
});
