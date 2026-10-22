/** Writes the OpenAPI document to docs/openapi.json. Run: npm run openapi:export */
import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument } from '../docs/openapi';

const out = path.resolve(__dirname, '../../../../docs/openapi.json');
fs.writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2));
console.log(`OpenAPI written to ${out}`);
