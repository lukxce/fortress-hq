"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Rendered into document.body. A fixed-position overlay inside an element with
 * a transform (every page's entrance animation has one) is positioned against
 * that element instead of the viewport, so it would only dim part of the page.
 */
export function Dialog({ onClose, children, locked = false }: { onClose: () => void; children: React.ReactNode; locked?: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !locked) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, locked]);
  if (!mounted) return null;
  return createPortal(
    <div className="dialog-backdrop" onClick={() => !locked && onClose()}>
      <div className="dialog" role="alertdialog" aria-modal onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
