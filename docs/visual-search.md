# Visual fabric search

Customers photograph or upload a fabric and get visually similar products from market shops, ranked by image-embedding similarity. Text and OCR are not used for matching.

## Pipeline

**Catalogue side** (`apps/api/src/modules/visual-search/embedding.service.ts`)

1. A seller uploads product images. Each one is validated, EXIF/GPS stripped, re-encoded to WebP and stored with a thumbnail.
2. An `embedding.generate` job is queued per image (durable MongoDB job queue, retries with exponential backoff, de-duplicated per image). Uploads are never blocked by the provider.
3. The worker normalises the stored image (orientation, 512×512 centre crop, sRGB JPEG), calls the provider, and upserts a `ProductEmbedding` row: vector plus denormalised filter fields (`searchable`, `inStock`, `retailPriceKobo`, `wholesale`, `categoryId`, `marketId`, `houseId`).
4. Product/shop changes (publish, archive, moderation, stock, shop suspension, house moves) keep those filter fields in sync, so unpublished or unlisted products never match.

**Query side** (`POST /api/v1/visual-search`)

1. Validates size (≤ 8 MB), MIME type, real decoded format and dimensions.
2. Applies **the same normalisation** as catalogue images, so EXIF is removed. The query image is processed in memory and never stored.
3. Embeds the image, then queries for the nearest image vectors with filters applied *before* ranking.
4. Merges multiple images of one product into a single result (best image wins), drops anything under the provider's similarity threshold, re-checks each product is still public, and pages through the results.
5. Ranked candidate ids (never the image) are cached for 15 minutes under a hash, so `GET /visual-search/results/:searchId?page=2` pages without re-uploading.

Results carry `similarity` (cosine, 0–1) and a band (`best_match` / `very_similar` / `similar` / `somewhat_similar`). Learned models such as Jina CLIP score every fabric of the same kind highly (bazin vs bazin is typically 0.82–0.93), so each band takes the weaker of two grades: one against the threshold and one against the best score of that search (within 0.03 of the top → very similar, within 0.08 → similar). The top result is labelled **Best match**, and highlighted in the app, only when it is strong (at least halfway between the threshold and 1) and at least 0.03 ahead of the runner-up. With the seed photos, the right product always comes first: 0.99 for the same photo and 0.91–0.94 for a cropped, rotated shot, 0.04–0.08 ahead of the next fabric. No band claims an identical fabric. When the provider fails, the API returns `503 VISUAL_SEARCH_PROVIDER_ERROR` instead of falling back to unrelated products, and the app offers text search.

`GET /visual-search/products/:id/similar` powers "Visually similar fabrics" on product pages using stored vectors (no provider call).

## Providers

Set `IMAGE_EMBEDDING_PROVIDER` and, for paid providers, `IMAGE_EMBEDDING_API_KEY`:

| Value | Model (default) | Dimensions | Notes |
|---|---|---|---|
| `jina` | `jina-clip-v2` | 1024 (`IMAGE_EMBEDDING_DIMENSIONS` can lower it, e.g. 512) | CLIP-style multimodal embeddings, https://jina.ai/embeddings |
| `cohere` | `embed-v4.0` | 1024 (256/512/1024/1536) | Image input, https://docs.cohere.com/docs/embeddings |
| `local-baseline` | `hsv-layout-texture-v1` | 188 | **Development only.** Hand-crafted colour histogram + layout + texture descriptor. Works offline for colourways and stripes/checks, but it is not a learned model. Refused in production. |
| `none` | — | — | Visual search is reported as unavailable; the rest of the app works. |

Default similarity thresholds are calibrated per provider (`jina` 0.60, `cohere` 0.50, `local-baseline` 0.80). Tune with `VISUAL_SEARCH_MIN_SIMILARITY` after testing on real catalogue photos.

To add another provider, implement `ImageEmbeddingProvider` in `providers.ts` (`embed(images: Buffer[]): Promise<number[][]>`, plus name/model/dimensions) and register it in `embeddingProvider()`.

**Changing provider or model** creates a new vector space. Embeddings are keyed by provider + model, so old vectors are simply ignored. Run the backfill:

```bash
npm run embeddings:backfill -w @kkdm/api
```

## Vector search backends

### Exhaustive (default: `VECTOR_SEARCH_PROVIDER=exhaustive`)

The API streams pre-filtered embeddings from MongoDB and computes cosine similarity in process, up to `VECTOR_SEARCH_EXHAUSTIVE_LIMIT` vectors (default 20,000). This is fine for development and a few thousand product images. It needs no extra setup.

### MongoDB Atlas Vector Search (`VECTOR_SEARCH_PROVIDER=atlas`), recommended for production

Requires an Atlas cluster (M10+ recommended for production; M0/Flex can be used for trials).

1. Configure the embedding provider first (the index dimension depends on it).
2. Run `npm run db:indexes`. With `VECTOR_SEARCH_PROVIDER=atlas` it creates (or updates) a search index named `VECTOR_SEARCH_INDEX_NAME` (default `product_image_embeddings`) on `productembeddings`:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "provider" },
    { "type": "filter", "path": "model" },
    { "type": "filter", "path": "searchable" },
    { "type": "filter", "path": "categoryId" },
    { "type": "filter", "path": "marketId" },
    { "type": "filter", "path": "houseId" },
    { "type": "filter", "path": "wholesale" },
    { "type": "filter", "path": "inStock" },
    { "type": "filter", "path": "retailPriceKobo" },
    { "type": "filter", "path": "productId" }
  ]
}
```

   You can also create it manually in Atlas → Search → Create Search Index → Atlas Vector Search → JSON editor.
3. Wait until the index status is **READY** in the Atlas UI.
4. Run the backfill if products already exist.

Until the index exists, Atlas queries fail and the API returns `503 VECTOR_INDEX_UNAVAILABLE` with a log message. It does not silently fall back.

## Costs and abuse protection

- `POST /visual-search` is limited to 10 requests per minute per user/IP, and uploads are capped at 8 MB.
- Identical query images (same normalised hash + filters) reuse cached candidates for 15 minutes without calling the provider.
- Catalogue embeddings are generated once per image; retries are bounded (5 attempts), then the image is marked `failed` and sellers can retry from the product editor.

## Limitations (stated honestly in the app)

- Similarity is visual (colour, pattern, motif, overall design). The system does **not** identify material composition from a photo; material fields are seller-stated.
- Lighting, cropping and backgrounds affect results; the app tells users to fill the frame with the fabric.
