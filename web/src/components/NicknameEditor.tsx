import { useState } from 'react';

interface Props {
  current: string;
  minLength: number;
  maxLength: number;
  busy: boolean;
  onRename: (nickname: string) => Promise<void>;
}

export default function NicknameEditor({ current, minLength, maxLength, busy, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);

  if (!editing) {
    return (
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => {
          setDraft(current);
          setEditing(true);
        }}
      >
        昵称：{current}
      </button>
    );
  }

  const trimmed = draft.trim();
  const valid =
    Array.from(trimmed).length >= minLength && Array.from(trimmed).length <= maxLength;

  return (
    <form
      className="nickname-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid) return;
        await onRename(trimmed);
        setEditing(false);
      }}
    >
      <input
        className="input input--sm"
        value={draft}
        maxLength={maxLength + 4}
        autoFocus
        aria-label="修改昵称"
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="submit" className="btn btn--sm btn--primary" disabled={busy || !valid}>
        保存
      </button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(false)}>
        取消
      </button>
    </form>
  );
}
