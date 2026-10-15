// Takes a language-neutral path (see stripLocale), so /th/products/c/<slug> matches once stripped.
export function isCategoryPath(path: string): boolean {
  return /^\/products\/c\/[^/]+\/?$/.test(path);
}
