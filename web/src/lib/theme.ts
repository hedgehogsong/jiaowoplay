export type Theme = 'light' | 'dark';

const THEME_KEY = 'jiaowoplay:theme';
const THEME_COLOR: Record<Theme, string> = { light: '#f4f5fb', dark: '#141326' };

function stored(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 没有选择记录时一律用浅色，新用户第一眼就是白底 */
export function resolveTheme(): Theme {
  try {
    return stored()?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // 手机浏览器的地址栏底色跟着主题走
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

export function saveTheme(theme: Theme): void {
  try {
    stored()?.setItem(THEME_KEY, theme);
  } catch {
    /* 存不下也不影响本次会话的切换 */
  }
}
