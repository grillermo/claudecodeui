import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ASSET_MANIFEST_NAME, buildAssetManifest } from '@/modules/assets/services/asset-manifest.service.js';

const dist = path.resolve(process.cwd(), 'dist');
const manifest = await buildAssetManifest(dist);
await writeFile(path.join(dist, ASSET_MANIFEST_NAME), JSON.stringify(manifest));
console.log(`asset manifest: ${manifest.buildId}, ${manifest.files.length} files`);
