import assert from 'node:assert/strict';
import test from 'node:test';

import { staticCacheControl } from '@/modules/assets/services/static-cache-policy.js';

test('html is never stored', () => {
  assert.equal(staticCacheControl('index.html'), 'no-cache, no-store, must-revalidate');
});

test('hashed assets are immutable', () => {
  assert.equal(staticCacheControl('assets/app-abc.js'), 'public, max-age=31536000, immutable');
});

test('anything else revalidates', () => {
  assert.equal(staticCacheControl('logo.png'), 'no-cache');
  assert.equal(staticCacheControl('asset-manifest.json'), 'no-cache');
});
