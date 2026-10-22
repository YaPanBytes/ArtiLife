import { bytesToBase64, base64ToBytes } from './sim/base64';
import { DEFAULT_CONFIG, resolveConfig, type SimConfig } from './sim/config';

/** The settings that differ from `base`, as a nested object holding only those. */
export function configDiff(config: object, base: object = DEFAULT_CONFIG): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const reference = (base as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null) {
      const inner = configDiff(value, (reference ?? {}) as object);
      if (Object.keys(inner).length > 0) diff[key] = inner;
    } else if (value !== reference) {
      diff[key] = value;
    }
  }
  return diff;
}

const toUrlSafe = (text: string) => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (text: string) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
};

/**
 * A short text that stands for a world's seed and rules, safe to put in a link.
 * Starting from the same code gives the same world; it does not capture a run in progress.
 */
export function encodeShare(config: SimConfig): string {
  const json = JSON.stringify(configDiff(config));
  return toUrlSafe(bytesToBase64(new TextEncoder().encode(json)));
}

/** The settings a share code stands for. Throws a RangeError, with a reason, if it is not valid. */
export function decodeShare(code: string): SimConfig {
  let diff: unknown;
  try {
    diff = JSON.parse(new TextDecoder().decode(base64ToBytes(fromUrlSafe(code))));
  } catch {
    throw new RangeError('this share code is not valid');
  }
  if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) {
    throw new RangeError('this share code is not valid');
  }
  return resolveConfig(diff);
}

/** A link to this page that starts the given world. */
export function shareUrl(config: SimConfig, base: string): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('s', encodeShare(config));
  return url.toString();
}
