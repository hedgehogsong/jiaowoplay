import type { Toast } from '../hooks/useRoom.js';

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export default function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.tone}`}
          onClick={() => onDismiss(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  );
}
