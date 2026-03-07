export interface PaletteShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

export function isPaletteOpenShortcut(event: PaletteShortcutEvent): boolean {
  const lower = event.key.toLowerCase();
  if (event.altKey) return false;
  if ((Boolean(event.metaKey) || Boolean(event.ctrlKey)) && lower === "k") return true;
  return !Boolean(event.metaKey) && !Boolean(event.ctrlKey) && lower === "/";
}
