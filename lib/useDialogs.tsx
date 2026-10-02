import React, { useCallback, useRef, useState } from 'react';
import InlineDialog, { DialogState } from '../components/InlineDialog';

type Opts = { confirmLabel?: string; danger?: boolean };

/** Promise-based alert/confirm/prompt. Render `dialogElement` once in the component tree. */
export function useDialogs() {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const counter = useRef(0);

  const showAlert = useCallback(
    (title: string, message: string): Promise<void> =>
      new Promise(resolve =>
        setDialog({ id: ++counter.current, type: 'alert', title, message, onConfirm: () => resolve() })
      ),
    []
  );

  const showConfirm = useCallback(
    (title: string, message: string, opts: Opts = {}): Promise<boolean> =>
      new Promise(resolve =>
        setDialog({
          id: ++counter.current, type: 'confirm', title, message, ...opts,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        })
      ),
    []
  );

  const showPrompt = useCallback(
    (title: string, message: string, defaultValue?: string, opts: Opts = {}): Promise<string | null> =>
      new Promise(resolve =>
        setDialog({
          id: ++counter.current, type: 'prompt', title, message, defaultValue, ...opts,
          onConfirm: val => resolve(val ?? null),
          onCancel: () => resolve(null),
        })
      ),
    []
  );

  const dialogElement = dialog ? (
    <InlineDialog key={dialog.id} dialog={dialog} onClose={() => setDialog(null)} />
  ) : null;

  return { showAlert, showConfirm, showPrompt, dialogElement };
}
