import { useEffect } from "react";
import { useAuthStore } from "../lib/store";

const COLORS = {
  success: "bg-emerald-600 border-emerald-500",
  error: "bg-red-600 border-red-500",
  info: "bg-blue-600 border-blue-500",
};

export function Toasts() {
  const { toasts, removeToast } = useAuthStore();

  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(() => removeToast(t.id), 5000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm text-white shadow-lg ${COLORS[toast.type]}`}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-white/60 hover:text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
