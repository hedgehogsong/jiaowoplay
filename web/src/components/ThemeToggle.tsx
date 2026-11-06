import { useTheme } from '../hooks/useTheme.js';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel = theme === 'dark' ? '浅色' : '深色';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      title={`切换到${nextLabel}模式`}
      aria-label={`切换到${nextLabel}模式`}
    >
      <span aria-hidden>{theme === 'dark' ? '🌞' : '🌙'}</span>
    </button>
  );
}
