import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../../lib/adminApi.js';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
}

export default function AdminLoginDialog({ open, onClose, onSuccess }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.login(username.trim(), password);
      // 成功后立刻丢弃表单里的明文密码
      setPassword('');
      setUsername('');
      onSuccess(result.token);
    } catch (caught) {
      setPassword('');
      const message = caught instanceof Error ? caught.message : '登录失败，请稍后再试';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="presentation" onMouseDown={onClose}>
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label="开发者后台登录"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="modal__title">开发者后台</h2>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">账号</span>
            <input
              ref={firstFieldRef}
              className="input"
              value={username}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">密码</span>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || username.length === 0 || password.length === 0}
            >
              {busy ? '登录中…' : '登录'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
