import { useEffect, useState, type FormEvent } from 'react';
import { formatCountdown, remainingMs, useNow } from '../../../hooks/useNow.js';

interface Props {
  prompt: string;
  roundNumber: number;
  deadline: number | null;
  serverOffset: number;
  submitted: boolean;
  submittedCount: number;
  activeCount: number;
  maxLength: number;
  busy: boolean;
  onSubmit: (word: string) => Promise<void>;
}

export default function WordSubmit({
  prompt,
  roundNumber,
  deadline,
  serverOffset,
  submitted,
  submittedCount,
  activeCount,
  maxLength,
  busy,
  onSubmit,
}: Props) {
  const [word, setWord] = useState('');
  const now = useNow(500);
  const left = remainingMs(deadline, now, serverOffset);

  useEffect(() => {
    setWord('');
  }, [roundNumber]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = word.trim();
    if (value.length === 0 || submitted) return;
    await onSubmit(value);
    setWord('');
  };

  return (
    <div className="submit">
      <div className="submit__meta">
        <span className="chip">第 {roundNumber} 轮</span>
        {deadline && (
          <span className={`chip ${left < 10_000 ? 'chip--warn' : ''}`}>剩余 {formatCountdown(left)}</span>
        )}
        <span className="chip">
          已提交 {submittedCount}/{activeCount}
        </span>
      </div>

      <p className="submit__prompt">{prompt}</p>

      {submitted ? (
        <div className="submit__done">
          <span className="dot dot--ok" aria-hidden />
          已提交，等待其他玩家…
        </div>
      ) : (
        <form className="submit__form" onSubmit={handleSubmit}>
          <input
            className="input"
            type="text"
            value={word}
            maxLength={maxLength}
            autoComplete="off"
            placeholder={`输入一个词（1-${maxLength} 字）`}
            aria-label="本轮提交的词"
            onChange={(event) => setWord(event.target.value)}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || word.trim().length === 0}
          >
            提交
          </button>
        </form>
      )}
      <p className="hint">提交后不可修改，且在揭晓前看不到其他人的词。</p>
    </div>
  );
}
