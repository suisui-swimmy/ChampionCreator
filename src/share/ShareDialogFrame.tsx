import { type ReactNode, useEffect, useId, useRef } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";

export function ShareDialogFrame({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialogRef} className="share-dialog" aria-labelledby={titleId} tabIndex={-1}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea, input:not([disabled]), select:not([disabled])"))
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <div className="share-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="share-close" aria-label="閉じる" onClick={onClose}><Cross2Icon aria-hidden="true" /></button></div>
    {children}
  </dialog>;
}
