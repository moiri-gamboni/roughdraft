export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  copyTextWithExecCommand(text);
}

// navigator.clipboard only exists in secure contexts; over plain http (e.g. a
// LAN or tailnet IP) the legacy execCommand path is the only way to copy.
function copyTextWithExecCommand(text: string) {
  const previousActiveElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
    if (selection && previousRange) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    previousActiveElement?.focus({ preventScroll: true });
  }

  if (!copied) {
    throw new Error("Copying to the clipboard is not supported here");
  }
}
