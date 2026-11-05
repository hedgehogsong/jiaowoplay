export function formatDateTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
}

/** 对局 ID 只展示短码，完整 ID 放在 title 里便于排查 */
export function shortId(id: string): string {
  const body = id.startsWith('gs_') ? id.slice(3) : id;
  return body.slice(0, 8);
}
