/**
 * Saved home data changed (moods, the map): anything built from it elsewhere (the Quick Settings
 * tile's requests) follows. A tiny bus, so the stores don't import what depends on them.
 */
const listeners = new Set<() => void>();

export function onSavedDataChange(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const savedDataChanged = () => listeners.forEach((l) => l());
