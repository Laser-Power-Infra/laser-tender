// Accuracy evaluation of the AI mail reading, against the team's own entries. Read-only: creates nothing, writes nothing.
//   npm run mail:eval -- [--n 30] [--days 7] [--only haiku-off,haiku-low,sonnet-low]
// It takes real feed mails whose enquiry already exists in the dashboard (entered by the team in Smartsheet), reads each with
// every candidate setting, and scores the fields the team filled. A blank from the AI is acceptable; a wrong value is not.
// This spends real money on the Claude API (about one US dollar for 30 mails with all three settings).
import { cliPool } from '../sync/env.ts';
import { httpFeed, istToday, loadKnown } from '../lib/mailIngest.ts';
import { buildIndex, matchThread, type FeedThread } from '../lib/mailMatch.ts';
import { anthropicClient, needsSecondRead, readMail, type ReadConfig, type ReadResult } from '../lib/mailExtract.ts';

const CANDIDATES: Record<string, ReadConfig> = {
  'haiku-off': { model: 'claude-haiku-5-5', thinking: false, effort: 'low' },
  'haiku-low': { model: 'claude-haiku-5-5', thinking: true, effort: 'low' },
  'sonnet-low': { model: 'claude-sonnet-5-5', thinking: true, effort: 'low' },
};
const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const alnum = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
type Score = 'right' | 'wrong' | 'blank';
const FIELDS = ['is an enquiry', 'product', 'category', 'utility', 'due date', 'enquiry no.'] as const;

async function main() {
  const n = Number(arg('n', '30')), days = Number(arg('days', '7'));
  const names = arg('only', Object.keys(CANDIDATES).join(',')).split(',').filter(k => CANDIDATES[k]);
  const { db, close } = await cliPool();
  const today = istToday();
  await db.query('SET default_transaction_read_only = on');

  // real mails whose enquiry exists: the team's entry is the answer key
  const feed = httpFeed();
  const threads = new Map<string, FeedThread>();
  let page = await feed.page(null, days);
  for (let i = 0; i < 40; i++) { for (const t of page.threads) threads.set(t.thread_id, t); if (!page.more) break; page = await feed.page(page.next_since, days); }
  const ix = buildIndex(await loadKnown(db), today);
  const truthRows = new Map<string, any>((await db.query(`SELECT docket_no, enquiry_category, utility, due_date::text AS due_date, enquiry_tender_no, project_name, enquiry_contact_person FROM enquiry WHERE deleted_at IS NULL AND master = 'smartsheet'`)).rows.map(r => [r.docket_no, r]));
  const utilities: string[] = (await db.query('SELECT name FROM ref_utility WHERE active')).rows.map(r => r.name);
  const filled = (e: any) => ['enquiry_category', 'utility', 'due_date', 'enquiry_tender_no'].filter(k => String(e[k] ?? '').trim()).length;
  const cases = [...threads.values()].flatMap(t => { const m = matchThread(t, ix); const e = m.status === 'linked' ? truthRows.get(m.docket_no) : null; return e ? [{ t, e }] : []; })
    .sort((a, b) => filled(b.e) - filled(a.e) || a.t.thread_id.localeCompare(b.t.thread_id)).slice(0, n);
  console.log(`feed threads: ${threads.size}; with an existing enquiry: usable ${cases.length} of the ${n} asked for\n`);
  await close();

  const client = anthropicClient();
  const score = (r: ReadResult, e: any): Record<(typeof FIELDS)[number], Score | null> => {
    const g = r.reading;
    const cmp = (got: unknown, want: unknown, eq: (a: string, b: string) => boolean): Score | null =>
      !String(want ?? '').trim() ? null : !String(got ?? '').trim() ? 'blank' : eq(String(got), String(want)) ? 'right' : 'wrong';
    return {
      // every case has a docket, so the mail is an enquiry (new or a follow-up on one) for a Laser product
      'is an enquiry': !g ? 'blank' : g.mail_type === 'new_enquiry' || g.mail_type === 'follow_up' ? 'right' : 'wrong',
      product: !g ? 'blank' : g.product === 'cables_or_conductors' ? 'right' : g.product === 'unclear' ? 'blank' : 'wrong',
      category: cmp(g?.category, e.enquiry_category, (a, b) => a === b),
      utility: cmp(r.utility, e.utility, (a, b) => a.trim() === b.trim()),
      'due date': cmp(g?.due_date?.value, e.due_date, (a, b) => a === b),
      'enquiry no.': cmp(g?.party_enquiry_no?.value, e.enquiry_tender_no, (a, b) => alnum(a).includes(alnum(b)) || alnum(b).includes(alnum(a))),
    };
  };

  for (const name of names) {
    const cfg = CANDIDATES[name];
    const tally: Record<string, Record<Score, number>> = Object.fromEntries(FIELDS.map(f => [f, { right: 0, wrong: 0, blank: 0 }]));
    const wrong: string[] = [];
    let input = 0, output = 0, cost = 0, second = 0, droppedProofs = 0, failed = 0;
    // four at a time: quick, and well inside the rate limits
    for (let i = 0; i < cases.length; i += 4) {
      await Promise.all(cases.slice(i, i + 4).map(async ({ t, e }) => {
        let r: ReadResult;
        try { r = await readMail(client, t, { utilities }, today, cfg); }
        catch (err) { failed++; wrong.push(`  ERROR ${t.subject.slice(0, 50)}: ${(err as Error).message.slice(0, 120)}`); return; }
        input += r.input_tokens; output += r.output_tokens; cost += r.cost_usd; droppedProofs += r.dropped.length;
        if (needsSecondRead(r.reading, r.dropped)) second++;
        const s = score(r, e);
        for (const f of FIELDS) {
          if (!s[f]) continue;
          tally[f][s[f]!]++;
          if (s[f] === 'wrong') wrong.push(`  ${f} | ${e.docket_no} | ${t.subject.slice(0, 50)} | AI: ${JSON.stringify(f === 'category' ? r.reading?.category : f === 'utility' ? r.utility : f === 'due date' ? r.reading?.due_date : f === 'enquiry no.' ? r.reading?.party_enquiry_no?.value : `${r.reading?.mail_type} / ${r.reading?.product}`)} | team: ${JSON.stringify(f === 'category' ? e.enquiry_category : f === 'utility' ? e.utility : f === 'due date' ? e.due_date : f === 'enquiry no.' ? e.enquiry_tender_no : 'has a docket')}`);
        }
      }));
    }
    const done = cases.length - failed;
    console.log(`=== ${name} (${cfg.model}, thinking ${cfg.thinking ? 'on' : 'off'}) ===`);
    console.log(`mails read ${done}${failed ? `, failed ${failed}` : ''} | tokens in ${input}, out ${output} | cost $${cost.toFixed(4)} = $${(cost / Math.max(done, 1)).toFixed(5)} per mail | would need a second read: ${second} | values dropped by the proof check: ${droppedProofs}`);
    console.log('field           | team filled | AI right | AI wrong | AI blank | right of answered');
    for (const f of FIELDS) {
      const x = tally[f], total = x.right + x.wrong + x.blank, answered = x.right + x.wrong;
      console.log(`${f.padEnd(15)} | ${String(total).padStart(11)} | ${String(x.right).padStart(8)} | ${String(x.wrong).padStart(8)} | ${String(x.blank).padStart(8)} | ${answered ? `${Math.round((100 * x.right) / answered)}%` : '-'}`);
    }
    if (wrong.length) console.log('wrong or failed:\n' + wrong.join('\n'));
    console.log('');
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
