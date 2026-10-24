/** Bump when the shape of cached data changes. */
export const CACHE_FORMAT_VERSION = 1;

declare const __ANALYZER_BUILD__: string | undefined;

/**
 * Identifies the analyzer logic that produced cached facts. Bundled builds replace `__ANALYZER_BUILD__` with
 * `<package version>+<content hash of src/>`, so any code change invalidates old caches automatically.
 */
export const ANALYZER_VERSION: string = typeof __ANALYZER_BUILD__ === 'string' ? __ANALYZER_BUILD__ : '0.1.0-source';
