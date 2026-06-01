export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Show a toast notification at the top center of the page */
export function showToast(
  message: string,
  type: 'success' | 'info' | 'error' = 'success',
  duration = 2500,
  action?: ToastAction,
): void {
  // Remove existing toast
  const existing = document.querySelector('.dxp-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'dxp-toast';

  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'dxp-toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
      action.onClick();
    });
    toast.appendChild(btn);
  }

  const bgColor =
    type === 'error'
      ? 'var(--danger, #d73a49)'
      : type === 'info'
        ? 'var(--tertiary, #00aeff)'
        : 'var(--success, #28a745)';

  Object.assign(toast.style, {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: bgColor,
    color: 'white',
    padding: '10px 20px',
    borderRadius: '8px',
    zIndex: '99999',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'opacity 0.3s',
    pointerEvents: action ? 'auto' : 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, action ? 8000 : duration);
}
