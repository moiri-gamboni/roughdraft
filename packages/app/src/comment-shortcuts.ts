export function isApplePlatform(platform?: string | null) {
  if (!platform) return false;

  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function getAddCommentShortcutLabel(platform?: string | null) {
  return isApplePlatform(platform) ? "Cmd + Option + M" : "Ctrl + Alt + M";
}

export interface AddCommentShortcutEventLike {
  code: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function matchesAddCommentShortcut(
  event: AddCommentShortcutEventLike,
  platform?: string | null,
) {
  if (event.shiftKey || event.code !== "KeyM" || !event.altKey) {
    return false;
  }

  return isApplePlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}
