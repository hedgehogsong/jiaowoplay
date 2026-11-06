import { useCallback, useEffect, useState } from 'react';
import { applyTheme, resolveTheme, saveTheme, type Theme } from '../lib/theme.js';

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  // 状态是唯一入口：切换后统一落到 <html data-theme> 与 localStorage
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
