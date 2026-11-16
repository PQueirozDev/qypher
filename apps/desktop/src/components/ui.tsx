import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, ShieldCheck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { severityLabel, statusLabel, type ScanStatus, type Severity } from '../types';
export function PageTitle({
  tag,
  title,
  description,
  action,
}: {
  tag: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{tag}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Panel({
  title,
  meta,
  children,
  className = '',
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  icon: Icon = ShieldCheck,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SeverityBadge({ value }: { value: Severity }) {
  return (
    <span className={`badge severity-${value}`}>
      <i />
      {severityLabel[value]}
    </span>
  );
}
export function StatusBadge({ value }: { value: ScanStatus }) {
  return (
    <span className={`badge status-${value}`}>
      <i />
      {statusLabel[value]}
    </span>
  );
}
export function ArrowButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function ConfirmDialog({
  title,
  children,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
    >
      <div className="dialog-heading">
        <h2 id="confirm-title">{title}</h2>
        <button className="icon-button" onClick={onCancel} aria-label="Fechar">
          <X size={18} />
        </button>
      </div>
      <p>{children}</p>
      <div className="button-row">
        <button className="button secondary" onClick={onCancel} autoFocus>
          Cancelar
        </button>
        <button className="button danger" onClick={onConfirm}>
          Excluir definitivamente
        </button>
      </div>
    </dialog>
  );
}
