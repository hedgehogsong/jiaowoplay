import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { clearAdminToken, loadAdminToken } from '../../lib/storage.js';
import { isAdminUnavailable, isUnauthorized } from '../../lib/adminApi.js';

/** 没有本地 Token 就直接退回前台；服务端仍会独立校验 JWT 签名与有效期 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  if (!loadAdminToken()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function useAdminGuard() {
  const navigate = useNavigate();
  // 只在挂载时读一次，避免每次渲染产生新引用而触发上层 useEffect 循环
  const [token] = useState(loadAdminToken);

  /** 返回要展示的提示；401 时已清凭证并回前台，返回 null */
  const handleAuthError = useCallback(
    (error: unknown): string | null => {
      if (isUnauthorized(error)) {
        clearAdminToken();
        navigate('/', { replace: true });
        return null;
      }
      if (isAdminUnavailable(error)) {
        return '后台未启用：服务器上还没有配置 ADMIN_USER / ADMIN_PASS / ADMIN_JWT_SECRET';
      }
      return error instanceof Error ? error.message : '加载失败，请稍后重试';
    },
    [navigate],
  );

  const signOut = useCallback(() => {
    clearAdminToken();
    navigate('/', { replace: true });
  }, [navigate]);

  return { token, handleAuthError, signOut };
}
