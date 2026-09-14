/** Ephemeral presentation state only; never persisted alongside calculator data. */
export type FooterStartupState = {
  open: boolean;
  restoreFocus: (footer: HTMLElement) => void;
};

export function captureFooterStartup(root: HTMLElement): FooterStartupState | undefined {
  const footer = root.querySelector<HTMLElement>(".app-footer--about");
  if (!footer) return undefined;
  const doc = root.ownerDocument;
  const focusables = Array.from(footer.querySelectorAll<HTMLElement>("summary, a"));
  const focusIndex = focusables.indexOf(doc.activeElement as HTMLElement);
  let interrupted = false;
  let restored = false;
  const interrupt = () => { interrupted = true; };
  if (focusIndex >= 0) {
    doc.addEventListener("focusin", interrupt);
    doc.addEventListener("pointerdown", interrupt);
    doc.addEventListener("keydown", interrupt);
  }
  return {
    open: footer.querySelector("details")?.open ?? false,
    restoreFocus(nextFooter) {
      if (restored) return;
      restored = true;
      doc.removeEventListener("focusin", interrupt);
      doc.removeEventListener("pointerdown", interrupt);
      doc.removeEventListener("keydown", interrupt);
      if (focusIndex < 0 || interrupted || doc.querySelector('[aria-modal="true"], dialog[open]')) return;
      if (doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement) return;
      nextFooter.querySelectorAll<HTMLElement>("summary, a")[focusIndex]?.focus({ preventScroll: true });
    },
  };
}
