import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const ASSET_MANIFEST_NAME = 'asset-manifest.json';

export type AssetManifest = {
  buildId: string;
  files: { path: string; sha256: string; size: number }[];
};

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export async function buildAssetManifest(dir: string): Promise<AssetManifest> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .map((full) => ({ full, relative: path.relative(dir, full).split(path.sep).join('/') }))
      .filter(({ relative }) => relative !== ASSET_MANIFEST_NAME)
      .map(async ({ full, relative }) => {
        const data = await readFile(full);
        return { path: relative, sha256: sha256(data), size: data.length };
      }),
  );
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const buildId = sha256(files.map((f) => `${f.path}:${f.sha256}`).join('\n')).slice(0, 16);
  return { buildId, files };
}
