import type { Dictionary } from '@/i18n/dictionaries';

/**
 * Scalable product navigation.
 *
 * Every area the product will eventually have is declared here ONCE, with an
 * `enabled` flag. Disabled areas render as feature-disabled placeholders so the
 * information architecture is ready for future phases without rebuilding the
 * shell. Labels come from the dictionary (never hard-coded in the sidebar).
 */

export type NavKey =
  | 'chat'
  | 'knowledge'
  | 'discover'
  | 'search'
  | 'templates'
  | 'projects'
  | 'agents'
  | 'files';

export interface NavItem {
  key: NavKey;
  /** Sub-path under /{locale}/app — e.g. 'chat' → /en/app/chat. */
  path: string;
  labelKey: keyof Dictionary['nav'];
  icon: string; // inline SVG path id resolved by <NavIcon>
  enabled: boolean;
}

export const primaryNav: NavItem[] = [
  { key: 'chat', path: 'chat', labelKey: 'chat', icon: 'chat', enabled: true },
  { key: 'knowledge', path: 'knowledge', labelKey: 'knowledge', icon: 'files', enabled: true },
  { key: 'discover', path: 'discover', labelKey: 'discover', icon: 'discover', enabled: false },
  { key: 'search', path: 'search', labelKey: 'search', icon: 'search', enabled: false },
  { key: 'templates', path: 'templates', labelKey: 'templates', icon: 'templates', enabled: false },
  { key: 'projects', path: 'projects', labelKey: 'projects', icon: 'projects', enabled: false },
  { key: 'agents', path: 'agent', labelKey: 'agent', icon: 'agents', enabled: true },
  { key: 'files', path: 'files', labelKey: 'files', icon: 'files', enabled: false },
];
