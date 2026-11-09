import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAssetManifest } from '@/modules/assets/services/asset-manifest.service.js';

async function fixture(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'manifest-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), body);
  }
  return dir;
}

test('lists every file with its hash and size, sorted, using forward slashes', async () => {
  const dir = await fixture({ 'index.html': 'a', 'assets/app.js': 'bb' });
  try {
    const manifest = await buildAssetManifest(dir);
    assert.deepEqual(manifest.files, [
      { path: 'assets/app.js', sha256: createHash('sha256').update('bb').digest('hex'), size: 2 },
      { path: 'index.html', sha256: createHash('sha256').update('a').digest('hex'), size: 1 },
    ]);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('excludes the manifest itself', async () => {
  const dir = await fixture({ 'index.html': 'a', 'asset-manifest.json': '{}' });
  try {
    const manifest = await buildAssetManifest(dir);
    assert.deepEqual(manifest.files.map((f) => f.path), ['index.html']);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('build id changes only when content changes', async () => {
  const one = await fixture({ 'index.html': 'a' });
  const same = await fixture({ 'index.html': 'a' });
  const other = await fixture({ 'index.html': 'b' });
  try {
    const [a, b, c] = await Promise.all([one, same, other].map(buildAssetManifest));
    assert.equal(a.buildId, b.buildId);
    assert.notEqual(a.buildId, c.buildId);
  } finally {
    await Promise.all([one, same, other].map((d) => rm(d, { recursive: true })));
  }
});
