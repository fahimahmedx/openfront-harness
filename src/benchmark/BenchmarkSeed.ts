import { simpleHash } from "../../OpenFrontIO/src/core/Util";

const CHARACTERS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SUFFIX_LENGTH = 3;
const SUFFIX_FACTOR = 31 ** SUFFIX_LENGTH;
let suffixes: Map<number, string> | null = null;
const aliases = new Map<string, string>();

function rawHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function suffixTable(): Map<number, string> {
  if (suffixes) return suffixes;
  suffixes = new Map();
  for (const first of CHARACTERS) {
    for (const second of CHARACTERS) {
      for (const third of CHARACTERS) {
        const value = `${first}${second}${third}`;
        suffixes.set(rawHash(value) >>> 0, value);
      }
    }
  }
  return suffixes;
}

function base62(value: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index++) {
    result = CHARACTERS[value % CHARACTERS.length] + result;
    value = Math.floor(value / CHARACTERS.length);
  }
  return result;
}

/**
 * Finds a schema-safe eight-character ID with exactly the same OpenFront RNG
 * seed as the shorter public task label. This keeps the normative seed and its
 * deterministic roster while satisfying GameRecordSchema's 8-character ID.
 */
export function replaySafeGameId(seed: string): string {
  if (/^[A-Za-z0-9]{8}$/.test(seed)) return seed;
  const cached = aliases.get(seed);
  if (cached) return cached;
  const target = simpleHash(seed);
  const targets = [target >>> 0, -target >>> 0];
  const table = suffixTable();
  const prefixCount = CHARACTERS.length ** 5;
  for (let index = 0; index < prefixCount; index++) {
    const prefix = base62(index, 5);
    const prefixContribution = Math.imul(rawHash(prefix), SUFFIX_FACTOR) >>> 0;
    for (const desired of targets) {
      const needed = (desired - prefixContribution) >>> 0;
      const suffix = table.get(needed);
      if (!suffix) continue;
      const alias = `${prefix}${suffix}`;
      if (simpleHash(alias) !== target) continue;
      aliases.set(seed, alias);
      return alias;
    }
  }
  throw new Error(`Could not derive a replay-safe game ID for seed ${seed}`);
}
