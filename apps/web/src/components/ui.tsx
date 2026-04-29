import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button className={`uiButton uiButton--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`uiCard ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function PageState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="uiState">
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      {action ? <div className="uiState__action">{action}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="uiModalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="uiModal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="uiModal__header">
          <h2>{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose} aria-label="Close dialog">
            Close
          </Button>
        </header>
        <div className="uiModal__body">{children}</div>
        {footer ? <footer className="uiModal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type ToastContextValue = {
  notify: (message: string, tone?: Toast["tone"]) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const value = useMemo<ToastContextValue>(
    () => ({
      notify: (message, tone = "info") => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, message, tone }]);
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 4200);
      },
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="uiToasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`uiToast uiToast--${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
