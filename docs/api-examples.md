# API examples

Base URL `http://localhost:4000/api/v1`. Full reference: Swagger UI at `/api/docs` or [`openapi.json`](openapi.json).

All responses use one envelope:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3, "hasNextPage": true } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "path": "email", "message": "…" }], "requestId": "…" } }
```

Money is integer **kobo** (₦1 = 100 kobo). Timestamps are ISO-8601 UTC.

```bash
API=http://localhost:4000/api/v1

# Register / login
curl -s $API/auth/register -H 'content-type: application/json' \
  -d '{"fullName":"Aisha Bello","email":"aisha@example.com","phone":"08031234567","password":"Passw0rd!"}'
TOKEN=$(curl -s $API/auth/login -H 'content-type: application/json' \
  -d '{"identifier":"customer1@demo.kantinkwari.test","password":"DemoPass123"}' | jq -r .data.tokens.accessToken)
AUTH="Authorization: Bearer $TOKEN"

# Refresh (rotates; reusing an old refresh token revokes the session)
curl -s $API/auth/refresh -H 'content-type: application/json' -d '{"refreshToken":"<refresh token>"}'

# Directory and search
curl -s "$API/markets"
curl -s "$API/shops?verifiedOnly=true&wholesaleOnly=true"
curl -s "$API/search/products?q=lace&maxPriceKobo=1500000&inStockOnly=true&sort=price_asc"
curl -s "$API/search/products?q=KW-024"              # house number → products in that house

# Visual fabric search (multipart)
curl -s -X POST "$API/visual-search?wholesaleOnly=true" -F image=@fabric.jpg

# Cart and checkout (one order per shop; idempotent)
curl -s $API/cart/items -H "$AUTH" -H 'content-type: application/json' -d '{"productId":"<id>","quantity":2.5}'
curl -s $API/checkout -H "$AUTH" -H 'content-type: application/json' -d '{
  "idempotencyKey":"5b0e3f62-9a9b-4b3e-8f2c-0c2b7a0e4c11",
  "shops":[{"shopId":"<shopId>","fulfilmentMethod":"pickup","paymentMethod":"cash_on_pickup"}]
}'

# Seller: accept an order (delivery orders with a quoted fee need deliveryFeeKobo)
curl -s $API/shops/<shopId>/orders/<orderId>/transition -H "$SELLER_AUTH" -H 'content-type: application/json' \
  -d '{"status":"accepted"}'

# House head: create a shop invitation (code returned once)
curl -s $API/houses/<houseId>/invitations -H "$HEAD_AUTH" -H 'content-type: application/json' -d '{"expiresInDays":7,"maxUses":1}'

# Shop owner: register a physical shop with the code
curl -s $API/shops/register -H "$AUTH" -H 'content-type: application/json' \
  -d '{"invitationCode":"ABCD-EFGH-JK","name":"Baba Textiles","shopNumber":"015"}'

# Quotation request
curl -s $API/quotations -H "$AUTH" -H 'content-type: application/json' \
  -d '{"shopId":"<shopId>","items":[{"productId":"<id>","quantity":50,"targetUnitPriceKobo":600000}],"message":"Price for 50 yards?"}'
```

Common error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `TOKEN_EXPIRED` (refresh and retry), `FORBIDDEN`, `MISSING_SHOP_PERMISSION`, `NOT_FOUND`, `INSUFFICIENT_STOCK`, `INVALID_TRANSITION`, `INVITATION_EXPIRED` / `_REVOKED` / `_EXHAUSTED` / `_INVALID`, `TOO_MANY_CODE_ATTEMPTS`, `RATE_LIMITED`, `ONLINE_PAYMENT_UNAVAILABLE`, `VISUAL_SEARCH_NOT_CONFIGURED`, `VISUAL_SEARCH_PROVIDER_ERROR`.
