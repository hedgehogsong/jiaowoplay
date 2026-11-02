import { useEffect, useState } from 'react';

/** 每秒刷新一次的时间戳，用于渲染服务端下发的倒计时 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export function remainingMs(deadline: number | null | undefined, now: number, serverOffset: number): number {
  if (!deadline) return 0;
  return Math.max(0, deadline - (now + serverOffset));
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, '0')}`
    : `${seconds} 秒`;
}
