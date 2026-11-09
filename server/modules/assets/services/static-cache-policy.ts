export function staticCacheControl(distRelativePath: string): string {
  const normalized = distRelativePath.split('\\').join('/');
  if (normalized.endsWith('.html')) return 'no-cache, no-store, must-revalidate';
  if (normalized.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}
