import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import { parseChampionsUsageData, type UsageDataValidationError } from "./schema";
import type { ChampionsUsageData } from "./types";

export { formatUsageDataDateJst } from "./date";

export const CHAMPIONS_USAGE_DATA_PATH = "data/champions-usage-current.json";
export const CHAMPIONS_USAGE_SOURCE_URL = "https://championsbattledata.com/";

export interface LoadChampionsUsageDataOptions {
  /** Injectable for tests; defaults to the browser's global fetch. */
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  path?: string;
}

export interface ChampionsUsageDataLoadResult {
  data: ChampionsUsageData | null;
  url: string;
  error?: unknown;
}

const resolveOptions = (
  optionsOrFetcher: LoadChampionsUsageDataOptions | typeof fetch | undefined,
): LoadChampionsUsageDataOptions => (
  typeof optionsOrFetcher === "function"
    ? { fetcher: optionsOrFetcher }
    : optionsOrFetcher ?? {}
);

/**
 * Fetch and validate the generated static payload. A failed fetch, non-2xx
 * response, invalid JSON, or schema violation returns `data: null`; callers
 * can keep their last-good in-memory state and still show the previous date.
 */
export const loadChampionsUsageData = async (
  optionsOrFetcher?: LoadChampionsUsageDataOptions | typeof fetch,
): Promise<ChampionsUsageDataLoadResult> => {
  const options = resolveOptions(optionsOrFetcher);
  const url = getPublicAssetUrl(options.path ?? CHAMPIONS_USAGE_DATA_PATH);
  const fetcher = options.fetcher ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);

  if (!fetcher) {
    return { data: null, url, error: new Error("fetch is unavailable") };
  }

  try {
    const response = await fetcher(url, options.signal ? { signal: options.signal } : undefined);
    if (!response.ok) {
      return { data: null, url, error: new Error(`Usage data request failed with HTTP ${response.status}`) };
    }
    const value: unknown = await response.json();
    return { data: parseChampionsUsageData(value), url };
  } catch (error) {
    return { data: null, url, error };
  }
};


export type { UsageDataValidationError };
