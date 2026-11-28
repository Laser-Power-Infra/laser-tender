// Enquiry mail ingest from the command line.
//   npm run sync:mail -- --dry-run     read the live feed and the enquiries, write nothing, call no AI: report what would happen
//   npm run sync:mail                  one real run (needs the enquiry_mail migration deployed)
//   npm run sync:mail -- --no-ai       store and link mails only; nothing is read or created
import { isMain, cliPool } from './env.ts';
import { aiReader, httpFeed, ingestMail, istToday, reconcileMailEnquiries } from '../lib/mailIngest.ts';

async function main() {
  const flags = new Set(process.argv.slice(2));
  const { db, close } = await cliPool();
  try {
    const today = istToday(), dryRun = flags.has('--dry-run');
    const read = dryRun || flags.has('--no-ai') ? undefined : await aiReader(db, today);
    const res = await ingestMail(db, { feed: httpFeed(), today, dryRun, read, maxAi: Number(process.env.MAIL_AI_MAX_PER_RUN) || 25 });
    console.log(JSON.stringify(res, null, 2));
    if (!dryRun) console.log('late duplicates:', JSON.stringify(await reconcileMailEnquiries(db, today)));
    if (res.errors.length) process.exitCode = 1;
  } finally { await close(); }
}

if (isMain(import.meta.url)) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
