// Smartsheet attachments -> server storage + attachment table. Smartsheet holds the files (TS, GTP, BOQ, enquiry mails, CSD/DD/BOM).
// They MUST be copied before Smartsheet is switched off. Row attachments only; comments/discussions are exported by export_discussions below.
//
//   SMARTSHEET_TOKEN=... DATABASE_URL=... ATTACHMENT_DIR=/srv/laser/attachments npx tsx sync/attachments_sync.ts [--sheet sales_enquiry]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Db, loadConfig } from './lib.ts';
import { isMain, cliPool, smartsheetToken } from './env.ts';

const H = (t: string) => ({ Authorization: `Bearer ${t}` });

async function getJson(url: string, token: string, attempt = 0): Promise<any> {
  const r = await fetch(url, { headers: H(token) });
  if ((r.status === 429 || r.status >= 500) && attempt < 6) { await new Promise(x => setTimeout(x, 2000 * 2 ** attempt)); return getJson(url, token, attempt + 1); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export const safeName = (s: string) => s.replace(/[^\w.\- ()]+/g, '_').slice(0, 150);

export async function syncAttachments(db: Db, token: string, sheetKey: string, dir: string) {
  const cfg = (loadConfig().smartsheet as any[]).find(s => s.key === sheetKey);
  const isEnq = cfg.kind === 'sales_enquiry';
  // Sheet-level attachment list returns all row attachments in one call (paged).
  let page = 1, done = 0, skipped = 0;
  for (;;) {
    const j = await getJson(`https://api.smartsheet.com/2.0/sheets/${cfg.sheetId}/attachments?includeAll=false&pageSize=500&page=${page}`, token);
    for (const a of j.data ?? []) {
      if (a.parentType !== 'ROW' || a.attachmentType === 'LINK') { skipped++; continue; }
      const exists = await db.query('SELECT 1 FROM attachment WHERE smartsheet_attachment_id=$1', [a.id]);
      if (exists.rows.length) continue;
      const row = await db.query(isEnq ? 'SELECT docket_no, NULL::bigint AS item_id FROM enquiry WHERE source_sheet_id=$1 AND smartsheet_row_id=$2'
                                       : 'SELECT docket_no, id AS item_id FROM enquiry_item WHERE source_sheet_id=$1 AND smartsheet_row_id=$2', [cfg.sheetId, String(a.parentId)]);
      if (!row.rows.length) { skipped++; continue; }            // row not imported yet; run smartsheet_sync first
      const meta = await getJson(`https://api.smartsheet.com/2.0/sheets/${cfg.sheetId}/attachments/${a.id}`, token); // fresh short-lived url
      const f = await fetch(meta.url);
      const buf = Buffer.from(await f.arrayBuffer());
      const docket = row.rows[0].docket_no as string;
      const folder = path.join(dir, safeName(docket)); fs.mkdirSync(folder, { recursive: true });
      const fname = `${a.id}_${safeName(a.name)}`; const full = path.join(folder, fname);
      fs.writeFileSync(full, buf);
      await db.query(`INSERT INTO attachment(docket_no,item_id,kind,filename,storage_path,sha256,bytes,source,smartsheet_attachment_id,uploaded_at)
                      VALUES ($1,$2,NULL,$3,$4,$5,$6,'smartsheet',$7,$8)`,
        [docket, row.rows[0].item_id, a.name, full, crypto.createHash('sha256').update(buf).digest('hex'), buf.length, a.id, a.createdAt ?? new Date().toISOString()]);
      done++;
    }
    if (!j.totalPages || page >= j.totalPages) break; page++;
  }
  return { downloaded: done, skipped };
}

async function main() {
  const { db: pool, close } = await cliPool();
  const want = process.argv.includes('--sheet') ? process.argv[process.argv.indexOf('--sheet') + 1] : 'all';
  for (const c of (loadConfig().smartsheet as any[]).filter(s => want === 'all' || s.key === want))
    console.log(c.key, await syncAttachments(pool, smartsheetToken(), c.key, process.env.ATTACHMENT_DIR ?? './attachments'));
  await close();
}
if (isMain(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
