import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastType = 'success' | 'error';

export interface ToastState {
  message: string;
  type: ToastType;
}

const TOAST_MS = 4000;

export function useToast(durationMs = TOAST_MS) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'success') => {
      clearToast();
      setToast({ message, type });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, durationMs);
    },
    [clearToast, durationMs]
  );

  useEffect(() => () => clearToast(), [clearToast]);

  return { toast, showToast, clearToast };
}

interface AdminToastProps {
  toast: ToastState | null;
  onDismiss?: () => void;
}

export function AdminToast({ toast, onDismiss }: AdminToastProps) {
  if (!toast) return null;

  const isSuccess = toast.type === 'success';

  return (
    <div
      className="fixed bottom-6 right-6 z-[100] max-w-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-start gap-3 rounded-xl px-4 py-3 shadow-xl border ${
          isSuccess
            ? 'bg-white border-green-200 text-green-900'
            : 'bg-white border-red-200 text-red-900'
        }`}
      >
        <span className="text-lg leading-none mt-0.5" aria-hidden>
          {isSuccess ? '✓' : '⚠'}
        </span>
        <p className="text-sm font-medium flex-1">{toast.message}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
