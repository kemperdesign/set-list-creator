import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';

// Replaces the browser alert/confirm/prompt dialogs, which are blocked in the hosted app
// (and unfriendly on phones).
export type DialogType = 'alert' | 'confirm' | 'prompt';

export interface DialogState {
  id: number;
  type: DialogType;
  title: string;
  message: string;
  defaultValue?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (value?: string) => void;
  onCancel?: () => void;
}

const InlineDialog: React.FC<{ dialog: DialogState; onClose: () => void }> = ({ dialog, onClose }) => {
  const [inputVal, setInputVal] = useState(dialog.defaultValue || '');

  const handleConfirm = () => {
    dialog.onConfirm(dialog.type === 'prompt' ? inputVal : undefined);
    onClose();
  };
  const handleCancel = () => {
    dialog.onCancel?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center gap-2">
          <AlertCircle className={`w-4 h-4 flex-shrink-0 ${dialog.danger ? 'text-red-400' : 'text-indigo-400'}`} />
          <h3 className="text-sm font-bold text-white">{dialog.title}</h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-300 whitespace-pre-line">{dialog.message}</p>
          {dialog.type === 'prompt' && (
            <input
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-indigo-500 outline-none"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleCancel();
              }}
            />
          )}
        </div>
        <div className="p-4 pt-0 flex justify-end gap-2">
          {dialog.type !== 'alert' && (
            <button onClick={handleCancel} className="px-4 py-2.5 text-xs font-bold text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors uppercase">
              Cancel
            </button>
          )}
          <button
            onClick={handleConfirm}
            className={`px-4 py-2.5 text-xs font-bold text-white rounded-lg transition-colors uppercase ${dialog.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {dialog.confirmLabel || (dialog.type === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InlineDialog;
