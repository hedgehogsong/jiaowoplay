export function formatDateTime(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 列表只精确到分钟，秒留给展开详情 */
export function formatDateTimeMinute(timestamp: number | null): string {
  if (timestamp === null) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
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
