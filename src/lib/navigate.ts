// Full-page navigations go through here so tests can mock them (jsdom's location is not spyable).
export function assignLocation(url: string): void {
  window.location.assign(url);
}

export function replaceLocation(url: string): void {
  window.location.replace(url);
}
