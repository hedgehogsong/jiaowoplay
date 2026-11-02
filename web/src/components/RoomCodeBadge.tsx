import { useState } from 'react';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 回退到 execCommand */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function RoomCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <div className="room-code">
      <span className="room-code__label">房间号</span>
      <strong className="room-code__value">{code}</strong>
      <button type="button" className="btn btn--ghost btn--sm" onClick={handleCopy}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}
