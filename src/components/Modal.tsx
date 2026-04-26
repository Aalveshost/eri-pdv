import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
    }
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-card w-full max-w-2xl p-8 border-luxury-orange/20 shadow-2xl animate-in zoom-in duration-200">
        <div className="flex items-center mb-8 relative">
          <h3 className="text-2xl font-extrabold italic text-luxury-orange uppercase tracking-[0.1em] w-full text-center pr-8">
            {title}
          </h3>
          <button 
            onClick={onClose} 
            tabIndex={-1}
            className="text-white/40 hover:text-white transition-colors absolute right-0"
          >
            <X size={24} />
          </button>
        </div>
        <div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
