import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { applyTheme, resolveTheme } from './lib/theme.js';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

// index.html 里已经预涂过一次，这里再对齐一次，保证与本地记录一致
applyTheme(resolveTheme());

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
