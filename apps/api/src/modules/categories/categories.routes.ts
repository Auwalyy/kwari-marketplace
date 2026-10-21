import { Router } from 'express';
import { z } from 'zod';
import { objectId, partialUpdate, slugSchema, type CategoryDto } from '@kkdm/shared';
import { Category, Product } from '../products/product.models';
import { authenticate, requirePlatformRole } from '../../middleware/auth';
import { audit } from '../../services/audit';
import { parse, paramId } from '../../utils/validate';
import { conflict, notFound, ok } from '../../utils/http';

export const categoriesRouter = Router();

const categoryInput = z.object({
  name: z.string().trim().min(2).max(60),
  slug: slugSchema,
  description: z.string().trim().max(500).optional(),
  parentId: objectId.nullable().optional(),
  iconName: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
});

function toDto(c: any, productCount?: number): CategoryDto {
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    description: c.description ?? undefined,
    parentId: c.parentId ? String(c.parentId) : null,
    iconName: c.iconName ?? undefined,
    productCount,
  };
}

categoriesRouter.get('/', async (_req, res) => {
  const cats = await Category.find({ active: true }).sort({ sortOrder: 1, name: 1 }).limit(500).lean();
  const counts = await Product.aggregate([
    { $match: { status: 'published', shopListed: true, moderationStatus: 'approved' } },
    { $group: { _id: '$categoryId', n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n as number]));
  ok(res, cats.map((c) => toDto(c, countMap.get(String(c._id)) ?? 0)));
});

categoriesRouter.post('/', authenticate, requirePlatformRole('admin'), async (req, res) => {
  const input = parse(categoryInput, req.body);
  if (await Category.exists({ slug: input.slug })) throw conflict('Category slug already exists', 'SLUG_TAKEN');
  const c = await Category.create(input);
  await audit({ req, action: 'category.created', category: 'admin', targetType: 'category', targetId: c._id });
  ok(res, toDto(c), 201);
});

categoriesRouter.patch('/:id', authenticate, requirePlatformRole('admin'), async (req, res) => {
  const c = await Category.findById(paramId(req.params.id));
  if (!c) throw notFound('Category');
  const input = parse(partialUpdate(categoryInput), req.body);
  if (input.slug && input.slug !== c.slug && (await Category.exists({ slug: input.slug }))) throw conflict('Category slug already exists', 'SLUG_TAKEN');
  c.set(input);
  await c.save();
  await audit({ req, action: 'category.updated', category: 'admin', targetType: 'category', targetId: c._id });
  ok(res, toDto(c));
});
