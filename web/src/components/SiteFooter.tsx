import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLoginDialog from './admin/AdminLoginDialog.js';
import { loadAdminToken, saveAdminToken } from '../lib/storage.js';

const REPO_URL = 'https://github.com/hedgehogsong/jiaowoplay';
const VERSION_LABEL = 'v1.1';
const CLICKS_TO_UNLOCK = 5;
const MAX_GAP_MS = 1_000;

export default function SiteFooter() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  // 记录上一次点击时间与连续次数：要求每两次点击间隔都不超过 1 秒
  const gestureRef = useRef({ count: 0, lastAt: 0 });

  const handleVersionClick = () => {
    const now = Date.now();
    const gesture = gestureRef.current;
    gesture.count = now - gesture.lastAt <= MAX_GAP_MS ? gesture.count + 1 : 1;
    gesture.lastAt = now;

    if (gesture.count < CLICKS_TO_UNLOCK) return;
    gesture.count = 0;
    gesture.lastAt = 0;

    if (loadAdminToken()) {
      navigate('/admin');
      return;
    }
    setDialogOpen(true);
  };

  const handleAuthorized = (token: string) => {
    saveAdminToken(token);
    setDialogOpen(false);
    navigate('/admin');
  };

  return (
    <footer className="site-footer">
      <button type="button" className="version-tag" onClick={handleVersionClick}>
        {VERSION_LABEL}
      </button>
      <div className="site-footer__line">
        <span>Developed by hedgehogsong from SJTU</span>
        <span className="site-footer__dot" aria-hidden>
          ·
        </span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          hedgehogsong/jiaowoplay
        </a>
      </div>
      <AdminLoginDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={handleAuthorized}
      />
    </footer>
  );
}
