import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

let activeEditFocusCount = 0;
const activeEditFocusStack: symbol[] = [];

type EditFocusDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  closeLabel?: string;
  busy?: boolean;
  /**
   * Use when the person needs to work across related records rather than make
   * one small edit. The page underneath remains inert, so no surrounding cards
   * can reflow or compete with the editing task.
   */
  fullScreen?: boolean;
};

/**
 * A shared, intentionally modal workspace for changing TeacherOS data.
 *
 * Keeping every edit flow in the same focused surface prevents a long dashboard
 * from competing with an unfinished form and gives every flow an explicit exit.
 */
export function EditFocusDialog({
  open,
  title,
  description,
  onClose,
  children,
  closeLabel = 'Exit editing',
  busy = false,
  fullScreen = false
}: EditFocusDialogProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const dialogTokenRef = useRef(Symbol('edit-focus-dialog'));

  useEffect(() => {
    if (!open) return;

    const dialogToken = dialogTokenRef.current;
    priorFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeEditFocusCount += 1;
    activeEditFocusStack.push(dialogToken);
    document.body.classList.add('edit-focus-open');
    const appRoot = document.getElementById('root');
    appRoot?.setAttribute('inert', '');
    appRoot?.setAttribute('aria-hidden', 'true');

    const focusPanel = window.requestAnimationFrame(() => panelRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (activeEditFocusStack[activeEditFocusStack.length - 1] !== dialogToken) {
        return;
      }
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusPanel);
      document.removeEventListener('keydown', onKeyDown);
      const stackIndex = activeEditFocusStack.lastIndexOf(dialogToken);
      if (stackIndex >= 0) activeEditFocusStack.splice(stackIndex, 1);
      activeEditFocusCount = Math.max(0, activeEditFocusCount - 1);
      if (activeEditFocusCount === 0) {
        document.body.classList.remove('edit-focus-open');
        appRoot?.removeAttribute('inert');
        appRoot?.removeAttribute('aria-hidden');
      }
      priorFocusRef.current?.focus();
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="edit-focus-layer" role="presentation">
      <div className="edit-focus-scrim" aria-hidden="true" />
      <section
        ref={panelRef}
        className={`edit-focus-panel${fullScreen ? ' edit-focus-panel-full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <header className="edit-focus-header">
          <div>
            <p className="eyebrow">Editing</p>
            <h2 id={headingId}>{title}</h2>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button
            className="secondary edit-focus-exit"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            {closeLabel}
          </button>
        </header>
        <div className="edit-focus-content">{children}</div>
      </section>
    </div>,
    document.body
  );
}
