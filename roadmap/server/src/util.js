export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Wraps an async route handler so rejections reach Express's error handler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function daysSince(isoString) {
  if (!isoString) return null;
  const then = Date.parse(isoString);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400_000);
}
