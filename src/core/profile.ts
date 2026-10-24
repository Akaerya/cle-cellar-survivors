import { DEFAULT_CHARACTER } from '../data/characters';

/** What a player is called and who they play as. Kept in localStorage and shared in co-op lobbies. */
export interface Profile {
  /** Display name; empty means "use the slot label" (P1..P4). */
  name: string;
  character: string;
}

export const NAME_MAX = 10;
/** Characters the pixel font can draw that make sense in a name. */
const NAME_CHARS = /[A-Z0-9 .\-_!?']/;
const KEY = 'cle-cellar-survivors-profile';

export function isNameChar(c: string): boolean {
  return c.length === 1 && NAME_CHARS.test(c.toUpperCase());
}

/** Uppercase, drawable characters only, at most NAME_MAX, no outer spaces. */
export function sanitizeName(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .split('')
    .filter(isNameChar)
    .join('')
    .slice(0, NAME_MAX)
    .trim();
}

export function displayName(name: string | undefined, slot: number): string {
  return name || `P${slot + 1}`;
}

export function loadProfile(): Profile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { name: sanitizeName(raw.name), character: typeof raw.character === 'string' ? raw.character : DEFAULT_CHARACTER };
  } catch {
    return { name: '', character: DEFAULT_CHARACTER };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the choice still lasts for this session.
  }
}
