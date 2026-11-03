const REPO_URL = 'https://github.com/hedgehogsong/jiaowoplay';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer__text">Developed by hedgehogsong from SJTU</span>
      <span className="site-footer__dot" aria-hidden>
        ·
      </span>
      <a
        className="site-footer__link"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        hedgehogsong/jiaowoplay
      </a>
    </footer>
  );
}
