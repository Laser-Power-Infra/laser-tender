// Type test certificates are PDFs on the office file server, in the "Updated TTR" folder next to the ledger that links to them.
// A browser will not open file:// links from a web page, so the app reads the file and serves it (app/api/type-test/file).
// Same setup as tender-executive-dashboard: TYPE_TEST_FILES_PATH is the "Updated TTR" folder as this machine sees it
// (a mounted volume in Docker), and a link is stored as a path relative to it.
import path from 'node:path';

export const typeTestRoot = () =>
  (process.env.TYPE_TEST_FILES_PATH || '').trim().replace(/^"|"$/g, '') || '\\\\192.168.1.242\\tender laser\\MD Work\\Updated TTR';

/** Where a ledger hyperlink can point, relative to the ledger's folder, most likely first. Empty for web links and absolute paths. */
export function certificateCandidates(target: string): string[] {
  let t = target.trim();
  try { t = decodeURIComponent(t); } catch { /* a stray % in a file name: keep it as written */ }
  t = t.replace(/\\/g, '/');
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('/')) return [];
  const below = t.replace(/^(\.\.\/)+/, '');
  // Most "../X" links were made when the ledger sat one folder deeper, so the file is in X; a few really are one level up.
  return below === t ? [t] : [below, `../${below}`];
}

/** Absolute path of a stored relative path. Null unless it stays in the root or its parent folder (a "../Conductors/..." sibling). */
export function certificatePath(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const full = path.resolve(path.join(base, rel.replace(/\\/g, '/')));   // "/" works on Windows and Linux alike
  const parent = path.dirname(base);
  return [base, parent].some(dir => dir !== path.parse(dir).root && full.startsWith(dir + path.sep)) ? full : null;
}
