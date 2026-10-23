import { Router, type Response } from 'express';
import { formatNaira, UNIT_LABELS, type ResellerListingDto, type ResellerPublicDto } from '@kkdm/shared';
import { Reseller, ResellerListing } from './reseller.models';
import { publicListings, toListingDtos, toResellerPublic } from './reseller.service';

/**
 * Plain web pages a reseller can share on WhatsApp: /r/:slug (all their products) and /l/:listingId (one
 * product). They work in any phone browser without the app, and the Open Graph tags give WhatsApp a
 * preview with the photo and price. The supplying shop never appears.
 */
export const resellerPagesRouter = Router();

const esc = (s: string | undefined | null) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const wa = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `234${d.slice(1)}` : d;
};
const unit = (l: ResellerListingDto) => UNIT_LABELS[l.product.unit]?.singular ?? l.product.unit;

function page(res: Response, opts: { title: string; description: string; image?: string | null; body: string }) {
  // Images come from the storage CDN, so this page needs its own policy instead of the API's strict one.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta property="og:title" content="${esc(opts.title)}"><meta property="og:description" content="${esc(opts.description)}">
${opts.image ? `<meta property="og:image" content="${esc(opts.image)}">` : ''}
<style>
:root{--g:#174F33;--c:#FAF6EC;--i:#151714;--m:#6B7069;--l:#E7E0CF}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--c);color:var(--i)}
header{background:var(--g);color:#fff;padding:20px 16px}header h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:#D6EADC;font-size:14px}
main{padding:16px;max-width:760px;margin:0 auto}.btns{display:flex;gap:8px;margin:12px 0 0;flex-wrap:wrap}
.btn{display:inline-block;padding:10px 16px;border-radius:12px;font-weight:600;text-decoration:none;font-size:15px}
.wa{background:#C9971C;color:#0C2A1C}.call{background:#fff;color:var(--g)}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media(min-width:600px){.grid{grid-template-columns:repeat(3,1fr)}}
.card{background:#fff;border:1px solid var(--l);border-radius:16px;overflow:hidden;text-decoration:none;color:inherit}
.card img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#F2EBDA}.card div{padding:8px 10px}
.name{font-size:14px;font-weight:600;margin:0}.price{font-size:16px;font-weight:700;margin:4px 0 0}.u{font-size:12px;color:var(--m);font-weight:400}
.hero{width:100%;max-height:60vh;object-fit:cover;border-radius:16px;display:block;background:#F2EBDA}.note{background:#FBF0D2;border-radius:12px;padding:12px;margin:12px 0}
.muted{color:var(--m);font-size:13px;line-height:1.5}footer{text-align:center;color:var(--m);font-size:12px;padding:24px 16px}
</style></head><body>${opts.body}<footer>Kantin Kwari Digital Market</footer></body></html>`);
}

function contact(r: ResellerPublicDto, message: string) {
  const phone = r.whatsapp || r.phone;
  return `<div class="btns">${phone ? `<a class="btn wa" href="https://wa.me/${wa(phone)}?text=${encodeURIComponent(message)}">WhatsApp ${esc(r.businessName)}</a>` : ''}${r.phone ? `<a class="btn call" href="tel:${esc(r.phone)}">Call</a>` : ''}</div>`;
}

resellerPagesRouter.get('/r/:slug', async (req, res) => {
  const r = await Reseller.findOne({ slug: String(req.params.slug).toLowerCase(), status: 'approved' }).lean();
  if (!r) {
    res.status(404);
    return page(res, { title: 'Seller not found', description: '', body: '<main><p>This seller page is not available.</p></main>' });
  }
  const profile = await toResellerPublic(r as any);
  const { items } = await publicListings({ resellerId: r._id }, 1, 60);
  const cards = items
    .map((l) => `<a class="card" href="/l/${l.id}"><img src="${esc(l.product.thumbnailUrl)}" alt=""><div><p class="name">${esc(l.product.name)}</p><p class="price">${esc(formatNaira(l.priceKobo))} <span class="u">/ ${esc(unit(l))}</span></p></div></a>`)
    .join('');
  page(res, {
    title: `${profile.businessName} — fabric`,
    description: `${items.length} fabrics${profile.area ? ` · ${profile.area}` : ''}. Order on WhatsApp.`,
    image: items[0]?.product.thumbnailUrl,
    body: `<header><h1>${esc(profile.businessName)}</h1><p>${esc([profile.area, `${items.length} product${items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</p>${contact(profile, `Hello ${profile.businessName}, I saw your fabrics on Kantin Kwari.`)}</header>
<main>${profile.about ? `<p class="muted">${esc(profile.about)}</p>` : ''}<div class="grid">${cards || '<p class="muted">Nothing for sale yet.</p>'}</div></main>`,
  });
});

resellerPagesRouter.get('/l/:listingId', async (req, res) => {
  const id = String(req.params.listingId);
  const l = /^[a-f\d]{24}$/i.test(id) ? await ResellerListing.findById(id).lean() : null;
  const [dto] = l ? await toListingDtos([l as any]) : [];
  if (!dto?.available) {
    res.status(404);
    return page(res, { title: 'Not available', description: '', body: '<main><p>This product is not available right now.</p></main>' });
  }
  const r = dto.reseller;
  page(res, {
    title: `${dto.product.name} — ${formatNaira(dto.priceKobo)} / ${unit(dto)}`,
    description: `Sold by ${r.businessName}. Order on WhatsApp.`,
    image: dto.product.images[0]?.url,
    body: `<header><h1>${esc(dto.product.name)}</h1><p>Sold by <a href="/r/${esc(r.slug)}" style="color:#fff">${esc(r.businessName)}</a></p></header>
<main><img class="hero" src="${esc(dto.product.images[0]?.url)}" alt="">
<p class="price" style="font-size:24px">${esc(formatNaira(dto.priceKobo))} <span class="u">/ ${esc(unit(dto))}</span></p>
${dto.note ? `<div class="note">${esc(dto.note)}</div>` : ''}
${contact(r, `Hello ${r.businessName}, I want ${dto.product.name} (${formatNaira(dto.priceKobo)} per ${unit(dto)}).`)}
${dto.product.description ? `<p class="muted" style="margin-top:16px">${esc(dto.product.description)}</p>` : ''}
<p class="muted">You arrange payment and delivery directly with ${esc(r.businessName)}.</p></main>`,
  });
});
