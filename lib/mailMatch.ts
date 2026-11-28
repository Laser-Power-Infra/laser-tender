// Pure matching for the enquiry mail ingest: does this mail belong to an enquiry that already exists, and who is the party?
// No database and no network here, so every rule is unit-tested (lib/mailMatch.test.ts).

export interface FeedThread {
  thread_id: string; kind: string; matched_on: string[]; date: string; last_updated: string;
  first_from: string; first_from_email: string; latest_from: string; message_froms: string[];
  to_details: string; cc_details: string; subject: string; company: string; msg_count: number;
  attach_names: string; attach_links: string; body: string; ocr_text?: string;
}

/** The fields of an existing enquiry that matching needs. */
export interface KnownEnquiry { docket_no: string; email_subject: string | null; enquiry_from_email: string | null; party_name: string | null; enquiry_date: string | null }

export type Match =
  | { status: 'linked'; docket_no: string; reason: string }
  | { status: 'review'; reason: string; candidates: string[] }
  | { status: 'new' };

// Mail providers anyone can use: a shared domain says nothing about the party.
const PUBLIC_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'hotmail.com', 'outlook.com', 'rediffmail.com', 'live.com', 'icloud.com', 'ymail.com']);
// Words that carry no identity in an enquiry subject.
const STOP = new Set(['re', 'fw', 'fwd', 'for', 'of', 'the', 'and', 'to', 'in', 'on', 'at', 'a', 'an', 'with', 'from', 'by', 'reg', 'regarding', 'rfq', 'enquiry', 'inquiry', 'quotation',
  'quote', 'request', 'offer', 'purchase', 'supply', 'requirement', 'price', 'rate', 'urgent', 'reminder', 'revised', 'cable', 'cables', 'conductor', 'conductors', 'no', 'nos', 'kv', 'project']);

/** Subject without reply/forward prefixes, punctuation and case: "RE: Fwd: RFQ - Cables!" -> "rfq cables". */
export const normSubject = (s: string | null | undefined) =>
  String(s ?? '').toLowerCase().replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, '').replace(/[^a-z0-9]+/g, ' ').trim();

const words = (s: string) => new Set(normSubject(s).split(' ').filter(w => w.length > 1 && !STOP.has(w)));
export const emailsIn = (s: string | null | undefined) => (String(s ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []);
export const domainOf = (email: string) => email.split('@')[1] ?? '';
const ownDomain = (email: string) => { const d = domainOf(email); return d && !PUBLIC_DOMAINS.has(d) ? d : ''; };

/** Share of the smaller word set that is also in the other: 1 = one subject contains the other's words. */
export function subjectOverlap(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (x.size < 2 || y.size < 2) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

/** Lookups built once per run from the existing enquiries. */
export interface EnquiryIndex {
  bySubject: Map<string, KnownEnquiry[]>;
  byEmail: Map<string, Map<string, number>>;     // sender address -> party -> how many enquiries
  byDomain: Map<string, Map<string, number>>;    // company domain  -> party -> how many enquiries
  recentByDomain: Map<string, KnownEnquiry[]>;   // company domain  -> enquiries of the last `recentDays`
  recentByParty: Map<string, KnownEnquiry[]>;
}

export function buildIndex(enquiries: KnownEnquiry[], today: string, recentDays = 120): EnquiryIndex {
  const ix: EnquiryIndex = { bySubject: new Map(), byEmail: new Map(), byDomain: new Map(), recentByDomain: new Map(), recentByParty: new Map() };
  const cutoff = new Date(new Date(today).getTime() - recentDays * 86400000).toISOString().slice(0, 10);
  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
  const count = (m: Map<string, Map<string, number>>, k: string, party: string) => { const p = m.get(k) ?? new Map(); p.set(party, (p.get(party) ?? 0) + 1); m.set(k, p); };
  for (const e of enquiries) {
    const subject = normSubject(e.email_subject);
    if (subject.length > 12) push(ix.bySubject, subject, e);        // a very short subject ("rfq", "quotation") identifies nothing
    const recent = !!e.enquiry_date && e.enquiry_date >= cutoff;
    const party = (e.party_name ?? '').trim();
    if (recent && party) push(ix.recentByParty, party, e);
    for (const em of emailsIn(e.enquiry_from_email)) {
      if (party) count(ix.byEmail, em, party);
      const d = ownDomain(em);
      if (!d) continue;
      if (party) count(ix.byDomain, d, party);
      if (recent) push(ix.recentByDomain, d, e);
    }
  }
  return ix;
}

/** The party of a sender, from past enquiries: the address first, then the company domain. Several parties = not decided here. */
export function partyOf(email: string, ix: EnquiryIndex): { party: string | null; candidates: string[]; via: 'address' | 'domain' | null } {
  const pick = (m: Map<string, number> | undefined, via: 'address' | 'domain') => {
    if (!m) return null;
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, n]) => s + n, 0);
    // one party, or one party behind at least 80% of this sender's enquiries
    const clear = ranked.length === 1 || ranked[0][1] / total >= 0.8;
    return { party: clear ? ranked[0][0] : null, candidates: ranked.slice(0, 3).map(r => r[0]), via };
  };
  return pick(ix.byEmail.get(email), 'address') ?? pick(ix.byDomain.get(ownDomain(email)), 'domain') ?? { party: null, candidates: [], via: null };
}

/**
 * Does the thread belong to an existing enquiry?
 *  linked  the subject is the same and the sender (address, company domain or party) is the same
 *  review  it looks like an existing one, or it is an ongoing conversation we cannot place: a person decides, nothing is created
 *  new     nothing like it exists
 */
export function matchThread(t: FeedThread, ix: EnquiryIndex): Match {
  const subject = normSubject(t.subject);
  const senders = [...new Set([t.first_from_email, ...t.message_froms.flatMap(emailsIn)].filter(Boolean))];
  const domains = new Set(senders.map(ownDomain).filter(Boolean));
  const party = partyOf(t.first_from_email, ix).party;
  const sameSender = (e: KnownEnquiry) => {
    const theirs = emailsIn(e.enquiry_from_email);
    return theirs.some(x => senders.includes(x) || domains.has(ownDomain(x))) || (!!party && e.party_name?.trim() === party);
  };

  const same = ix.bySubject.get(subject) ?? [];
  const exact = same.filter(sameSender);
  if (exact.length) {
    const newest = exact.reduce((a, b) => ((b.enquiry_date ?? '') > (a.enquiry_date ?? '') ? b : a));
    return { status: 'linked', docket_no: newest.docket_no, reason: `same subject and sender as ${newest.docket_no}` };
  }
  if (same.length) return { status: 'review', reason: 'same subject as an existing enquiry, but from a different sender', candidates: same.slice(0, 5).map(e => e.docket_no) };

  const near = new Map<string, number>();
  const consider = (list: KnownEnquiry[] | undefined) => { for (const e of list ?? []) { const o = subjectOverlap(t.subject, e.email_subject ?? ''); if (o >= 0.7) near.set(e.docket_no, Math.max(o, near.get(e.docket_no) ?? 0)); } };
  for (const d of domains) consider(ix.recentByDomain.get(d));
  if (party) consider(ix.recentByParty.get(party));
  if (near.size) return { status: 'review', reason: 'similar subject to a recent enquiry from the same party', candidates: [...near.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]) };

  // A conversation already several mails long was started before we saw it: its enquiry was probably entered under other words.
  if (t.msg_count >= 3) return { status: 'review', reason: `ongoing conversation of ${t.msg_count} mails with no matching enquiry`, candidates: [] };
  return { status: 'new' };
}
