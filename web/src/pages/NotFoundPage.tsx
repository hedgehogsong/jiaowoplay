import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="page page--center">
      <section className="panel panel--error">
        <p className="error-code">404</p>
        <h2>页面走丢了</h2>
        <p className="hint">你访问的地址不存在，或者房间链接有误。</p>
        <Link className="btn btn--primary" to="/">返回首页</Link>
      </section>
    </div>
  );
}
