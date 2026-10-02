import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Wider panel on desktop (default max-w-md). */
  wide?: boolean;
  /** Fill the whole screen on phones (used for lyrics). */
  fullOnMobile?: boolean;
  footer?: React.ReactNode;
}

/** Bottom sheet on phones, centered modal on desktop. Respects the iPhone safe areas. */
const Sheet: React.FC<SheetProps> = ({ title, onClose, children, wide, fullOnMobile, footer }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-end lg:items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`w-full ${wide ? 'lg:max-w-3xl' : 'lg:max-w-md'} bg-gray-900 border border-gray-800 shadow-2xl flex flex-col
          ${fullOnMobile ? 'h-[100dvh] rounded-none' : 'max-h-[88dvh] rounded-t-2xl'} lg:h-auto lg:max-h-[85vh] lg:rounded-2xl`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 bg-gray-800/20 flex-shrink-0"
          style={fullOnMobile ? { paddingTop: 'max(0.75rem, env(safe-area-inset-top))' } : undefined}
        >
          <h2 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2 min-w-0">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="border-t border-gray-800 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

export default Sheet;
