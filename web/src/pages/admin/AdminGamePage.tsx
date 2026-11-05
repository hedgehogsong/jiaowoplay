import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminSessionDetail, AdminSessionListPage, AdminSessionSummary } from '@jiaowoplay/shared';
import { adminApi } from '../../lib/adminApi.js';
import { formatDateTime, formatDuration, shortId } from '../../lib/format.js';
import { findGameBySlug } from '../../games/registry.js';
import { OUTCOME_TEXT } from '../../hooks/useRoom.js';
import RoundTimeline from '../../components/admin/RoundTimeline.js';
import { useAdminGuard } from '../../components/admin/RequireAdmin.js';

const PAGE_SIZE = 20;

function outcomeLabel(session: AdminSessionSummary): string {
  if (session.outcome === null) return `进行中（第 ${session.currentRound} 轮）`;
  const base = OUTCOME_TEXT[session.outcome] ?? '对局结束';
  if (session.outcome === 'ALL_MET') return `${base} · 共 ${session.roundCount} 轮`;
  return base;
}

export default function AdminGamePage() {
  const game = findGameBySlug(useParams<{ slug: string }>().slug);
  const { token, handleAuthError } = useAdminGuard();

  const [page, setPage] = useState(1);
  const [list, setList] = useState<AdminSessionListPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSessionDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    if (!game) return;
    setListLoading(true);
    setListError(null);
    try {
      setList(await adminApi.listSessions(token, page, PAGE_SIZE));
    } catch (error) {
      setListError(handleAuthError(error));
    } finally {
      setListLoading(false);
    }
  }, [game, handleAuthError, page, token]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const toggle = async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(sessionId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await adminApi.getSession(token, sessionId));
    } catch (error) {
      setDetailError(handleAuthError(error));
    } finally {
      setDetailLoading(false);
    }
  };

  if (!game) {
    return (
      <div className="page page--admin page--center">
        <section className="panel">
          <h2>没有这个游戏的后台数据</h2>
          <Link className="btn btn--primary" to="/admin">
            返回后台首页
          </Link>
        </section>
      </div>
    );
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

  return (
    <div className="page page--admin">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Developer Console</p>
          <h1 className="admin-title">{game.name} · 数据看板</h1>
        </div>
        <div className="admin-topbar__actions">
          <Link className="btn btn--ghost btn--sm" to="/admin">
            后台首页
          </Link>
          <Link className="btn btn--ghost btn--sm" to="/">
            返回前台
          </Link>
          <button type="button" className="btn btn--ghost btn--sm" onClick={loadList}>
            刷新
          </button>
        </div>
      </header>

      {listError && (
        <div className="banner banner--error" role="alert">
          {listError}
        </div>
      )}

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat__num">{list?.total ?? '—'}</span>
          <span className="admin-stat__label">历史对局</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat__num">{list ? list.items.length : '—'}</span>
          <span className="admin-stat__label">本页条数</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat__num">{totalPages}</span>
          <span className="admin-stat__label">总页数</span>
        </div>
      </div>

      <section className="admin-list">
        <div className="admin-row admin-row--head" aria-hidden>
          <span>对局 ID</span>
          <span>房间</span>
          <span>开始时间</span>
          <span>结束时间</span>
          <span>时长</span>
          <span>人数</span>
          <span>轮次</span>
          <span>结果</span>
        </div>

        {listLoading && <p className="admin-empty">加载中…</p>}
        {!listLoading && listError === null && (list?.items.length ?? 0) === 0 && (
          <p className="admin-empty">还没有任何对局记录。</p>
        )}

        {!listLoading &&
          list?.items.map((session) => {
            const open = expandedId === session.id;
            return (
              <div key={session.id} className={`admin-item ${open ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="admin-row"
                  onClick={() => void toggle(session.id)}
                  aria-expanded={open}
                >
                  <span className="mono" title={session.id}>
                    {shortId(session.id)}
                  </span>
                  <span className="mono">{session.roomCode}</span>
                  <span className="mono">{formatDateTime(session.startedAt)}</span>
                  <span className="mono">{formatDateTime(session.endedAt)}</span>
                  <span className="mono">{formatDuration(session.durationMs)}</span>
                  <span className="mono">{session.playerCount}</span>
                  <span className="mono">
                    {session.revealedRoundCount}/{session.roundCount}
                    {session.revealedRoundCount < session.roundCount && (
                      <em className="admin-flag">含未揭晓</em>
                    )}
                  </span>
                  <span className={`admin-outcome admin-outcome--${session.outcome ?? 'running'}`}>
                    {outcomeLabel(session)}
                    <span className="admin-caret" aria-hidden>
                      {open ? '▲' : '▼'}
                    </span>
                  </span>
                </button>

                <div className="admin-expand" data-open={open}>
                  <div className="admin-expand__inner">
                    {open && detailLoading && <p className="admin-empty">加载轮次详情…</p>}
                    {open && detailError && <p className="alert">{detailError}</p>}
                    {open && detail && (
                      <>
                        <p className="admin-meta">
                          完整 ID <code>{detail.id}</code> · 上限 {detail.maxRounds} 轮 ·{' '}
                          {detail.players.map((player) => player.nickname).join('、')}
                          {detail.winnerNicknames.length > 0 && (
                            <> · 胜者 {detail.winnerNicknames.join('、')}</>
                          )}
                        </p>
                        <RoundTimeline rounds={detail.rounds} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </section>

      <nav className="admin-pager">
        <button
          type="button"
          className="btn btn--sm"
          disabled={page <= 1 || listLoading}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
        >
          上一页
        </button>
        <span className="admin-pager__info">
          第 {page} / {totalPages} 页
        </span>
        <button
          type="button"
          className="btn btn--sm"
          disabled={page >= totalPages || listLoading}
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
        >
          下一页
        </button>
      </nav>
    </div>
  );
}
