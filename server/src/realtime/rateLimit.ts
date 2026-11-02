import type { Socket } from 'socket.io';

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_TRACKED_KEYS = 5_000;

/**
 * 轻量令牌桶，用于限制创建/加入房间的频率，
 * 防止房间号爆破与恶意刷房。仅按来源 IP 计数。
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  allow(key: string, cost = 1, now = Date.now()): boolean {
    this.prune(now);
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updatedAt = now;

    if (bucket.tokens < cost) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= cost;
    this.buckets.set(key, bucket);
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    if (this.buckets.size <= MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 10 * 60 * 1000) this.buckets.delete(key);
    }
  }
}

export function socketKey(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim();
  return first || socket.handshake.address || 'unknown';
}
