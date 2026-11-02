import type { ConnectionStatus } from '../hooks/useRoom.js';

const TEXT: Record<ConnectionStatus, string> = {
  idle: '尚未连接',
  connecting: '正在连接服务器…',
  connected: '',
  reconnecting: '连接中断，正在自动重连…',
  disconnected: '已断开连接',
};

export default function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') return null;
  return (
    <div className={`banner banner--${status === 'reconnecting' || status === 'connecting' ? 'warn' : 'error'}`}>
      <span className="banner__dot" aria-hidden />
      {TEXT[status]}
    </div>
  );
}
