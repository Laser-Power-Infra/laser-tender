// The AI reading of one enquiry mail (guideline 27 Nov 2026, section 3.1): what kind of mail it is and the enquiry fields it states.
// Accuracy comes before cost here, so every value that can be checked is checked against the mail text ("proof"),
// list values must exist in our lists, and a blank is always preferred to a guess. Cost is kept low by reading each
// new thread once with the cheap model and re-reading with the stronger one only when that reading fails its checks.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { FeedThread } from './mailMatch.ts';

const conf = z.enum(['high', 'medium', 'low']);
/** A value with the exact words of the mail it was read from. */
const quoted = <T extends z.ZodTypeAny>(value: T) => z.object({ value, quote: z.string() }).nullable();

export const MailReading = z.object({
  mail_type: z.enum(['new_enquiry', 'follow_up', 'order_or_execution', 'not_an_enquiry']),
  product: z.enum(['cables_or_conductors', 'other_product', 'unclear']),
  type_confidence: conf,
  summary: z.string(),
  party_company: z.string().nullable(),
  category: z.enum(['Tender', 'Purchase', 'Bugetary', 'Laser Tender']).nullable(),
  category_confidence: conf,
  party_enquiry_no: quoted(z.string()),
  due_date: quoted(z.string()),                 // YYYY-MM-DD
  utility: quoted(z.string()),
  project_name: z.string().nullable(),
  contact_person: z.string().nullable(),
  contact_no: quoted(z.string()),
  gtp_required: z.boolean().nullable(),
  csd_required: z.boolean().nullable(),
  drum_drawing_required: z.boolean().nullable(),
  type_test_required: z.boolean().nullable(),
  sample_required: z.boolean().nullable(),
  terms: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), qty: z.number().nullable(), unit: z.string().nullable(), quote: z.string() })),
});
export type MailReading = z.infer<typeof MailReading>;

const SYSTEM = `You read one business email thread received by Laser Power & Infra Ltd, an Indian manufacturer of power cables, control cables, aerial bunched cables, covered conductors and overhead conductors (ACSR, AAAC, AAC, earthwire). The sales team uses your reading to open an enquiry record, so a wrong value does harm and a blank does not.

Rules:
- Use only what the email and its attachment text say. If something is not stated, return null. Never infer or guess a value.
- For every field that has a "quote", copy the exact words from the email or attachment text that state the value, character for character, short (under 200 characters). If you cannot quote it, return null for that field.
- Dates as YYYY-MM-DD. The due date is the last date for submitting the offer or bid. It is not the date of the email, a delivery date or a validity date.

mail_type:
- new_enquiry: a customer or bidder asks Laser for a price, quotation, offer or budgetary rate for material, and this thread is that request.
- follow_up: a reply in an existing discussion (a reminder, a counter offer, a clarification, negotiation, a revised quantity on an offer already made).
- order_or_execution: purchase orders, letters of award, inspection, dispatch, payment, drawings for an order already placed.
- not_an_enquiry: anything else (notifications, vendor registration, sellers offering their own goods to Laser, internal notes).
type_confidence is your confidence in mail_type and product together.

product: cables_or_conductors when the material asked for is one of Laser's products listed above; other_product for anything else (valves, steel wire or strip, steel sections, hardware fittings, services); unclear if the material is not stated.

category, only for a new_enquiry, else null:
- "Tender": the sender is bidding in a utility's or owner's tender and wants Laser's price to prepare the bid (words like tender stage, pre-bid, for bidding purpose, NIT, we are participating).
- "Purchase": the sender already has the order or project and is buying.
- "Bugetary": a budgetary or estimate price is asked for.
- "Laser Tender": the mail asks Laser itself to bid in a tender, or is an internal instruction to create a docket for a tender Laser will bid in directly (GeM bid, e-tender).
category_confidence is low when the mail does not make this clear.

party_enquiry_no: the sender's own enquiry, RFQ, tender, NIT or bid number. utility: the end customer utility or owner the material is for (for example a state electricity board or PGCIL), exactly as written. project_name: the project or package name as written. contact_person and contact_no: the person to reply to, from the signature. party_company: the sender's company name as written in the signature or letterhead.

gtp_required, csd_required, drum_drawing_required, type_test_required, sample_required: true only if the mail or tender text asks for it to be submitted (GTP = guaranteed technical particulars; CSD = cross-section drawing); false only if it says it is not needed; otherwise null.

terms: payment, delivery and price-basis terms stated by the sender, in one or two short sentences, or null.

items: one entry per material line asked for, with the description as the sender wrote it (do not rewrite or standardise it), the quantity as a number and its unit. Do not merge or split lines. If the items are only in an attachment that is not included in the text, return an empty list.

summary: one plain sentence saying who asks for what.`;

export interface ReadConfig { model: string; thinking: boolean; effort?: 'low' | 'medium' | 'high' }
export interface ReadLists { utilities: string[] }
export interface ReadResult {
  reading: MailReading | null;          // null: the model declined or returned nothing usable
  utility: string | null;               // the utility-list entry the stated utility matched, if exactly one
  dropped: string[];                    // fields discarded because their proof was not in the mail
  truncated: boolean;                   // the mail was longer than what was sent
  model: string; escalated: boolean;
  input_tokens: number; output_tokens: number; cost_usd: number;
  note?: string;
}

// US dollars per million tokens (input, output). A model missing here is costed as 0 and shown as "cost unknown".
const PRICE: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
export const costOf = (model: string, input: number, output: number) => { const p = PRICE[model]; return p ? (input * p[0] + output * p[1]) / 1e6 : 0; };

const BODY_CHARS = 10000, OCR_CHARS = 14000;
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What is sent to the model: the start of the mail text and of the attachment text. `source` is what proofs are checked against. */
export function mailText(t: Pick<FeedThread, 'subject' | 'first_from' | 'to_details' | 'body' | 'ocr_text' | 'attach_names' | 'msg_count'>, today: string) {
  const body = t.body ?? '', ocr = t.ocr_text ?? '';
  const sent = [
    `Today's date: ${today}`, `Subject: ${t.subject}`, `From: ${t.first_from}`, `To: ${t.to_details}`, `Messages in thread: ${t.msg_count}`,
    `Attachment file names: ${t.attach_names || 'none'}`, '', '=== EMAIL TEXT ===', body.slice(0, BODY_CHARS), '', '=== TEXT EXTRACTED FROM ATTACHMENTS ===', ocr.slice(0, OCR_CHARS) || '(none)',
  ].join('\n');
  return { sent, source: `${t.subject}\n${body.slice(0, BODY_CHARS)}\n${ocr.slice(0, OCR_CHARS)}`, truncated: body.length > BODY_CHARS || ocr.length > OCR_CHARS };
}

/** A quote counts as proof when it is in the mail (ignoring spacing and case) and, where `value` is given, contains that value. */
export function proven(quote: string, source: string, value?: string): boolean {
  const q = squash(quote);
  if (q.length < 3 || !squash(source).includes(q)) return false;
  return value === undefined || alnum(quote).includes(alnum(value));
}

/** The one utility-list entry a stated utility means: same name, its abbreviation in brackets, or one name inside the other. */
export function matchUtility(stated: string, list: string[]): string | null {
  const s = squash(stated).replace(/[^a-z0-9 ]/g, '');
  if (s.length < 3) return null;
  const hits = list.filter(u => {
    const name = squash(u), plain = name.replace(/[^a-z0-9 ]/g, '');
    const abbr = [...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1].replace(/[^a-z0-9]/g, ''));
    return plain === s || abbr.includes(s.replace(/ /g, '')) || (s.length >= 6 && (plain.includes(s) || s.includes(plain.replace(/\([^)]*\)/g, '').trim())));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Discard values whose proof is not in the mail. Returns the cleaned reading and the names of what was dropped. */
export function verify(r: MailReading, source: string): { reading: MailReading; dropped: string[] } {
  const dropped: string[] = [];
  const keep = <T extends { value: string; quote: string } | null>(name: string, f: T, needValue: boolean): T | null => {
    if (!f) return f;
    if (proven(f.quote, source, needValue ? f.value : undefined)) return f;
    dropped.push(name);
    return null;
  };
  const due = r.due_date && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date.value) && !Number.isNaN(Date.parse(r.due_date.value)) ? r.due_date : (r.due_date && dropped.push('due_date'), null);
  const items = r.items.filter(i => proven(i.quote, source) || (dropped.push(`item: ${i.name.slice(0, 40)}`), false));
  return {
    dropped,
    reading: {
      ...r, items,
      party_enquiry_no: keep('party_enquiry_no', r.party_enquiry_no, true),
      due_date: keep('due_date', due, false),
      utility: keep('utility', r.utility, false),
      contact_no: keep('contact_no', r.contact_no, true),
    },
  };
}

export type MessagesClient = Pick<Anthropic, 'messages'>;
export const anthropicClient = (): MessagesClient => {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY is not set');
  return new Anthropic({ apiKey });
};

async function readOnce(client: MessagesClient, text: ReturnType<typeof mailText>, cfg: ReadConfig) {
  const res = await client.messages.parse({
    model: cfg.model,
    max_tokens: 6000,
    system: SYSTEM,
    messages: [{ role: 'user', content: text.sent }],
    // Haiku 5.5 accepts thinking off; Sonnet 5.5 and Opus 5.5 do not, so "thinking: false" is only honoured where it is allowed.
    ...(cfg.thinking ? { thinking: { type: 'adaptive' as const } } : cfg.model.startsWith('claude-haiku') ? { thinking: { type: 'disabled' as const } } : {}),
    output_config: { format: zodOutputFormat(MailReading), ...(cfg.effort ? { effort: cfg.effort } : {}) },
  });
  const usable = res.stop_reason === 'end_turn' && res.parsed_output;
  return {
    raw: usable ? res.parsed_output! : null,
    note: usable ? undefined : `model stopped with "${res.stop_reason}"`,
    input: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), output: res.usage.output_tokens,
  };
}

/** True when the cheap reading should not be trusted on its own. */
export const needsSecondRead = (reading: MailReading | null, dropped: string[]) =>
  !reading || reading.type_confidence === 'low' || dropped.some(d => d === 'party_enquiry_no' || d === 'due_date');

/**
 * Read one mail. `escalate` (optional) is the stronger setting used only when the first reading fails its checks.
 * API errors are thrown to the caller, which leaves the mail unread for the next run.
 */
export async function readMail(client: MessagesClient, t: FeedThread, lists: ReadLists, today: string, cfg: ReadConfig, escalate?: ReadConfig): Promise<ReadResult> {
  const text = mailText(t, today);
  let model = cfg.model, escalated = false, input = 0, output = 0, cost = 0;
  const attempt = async (c: ReadConfig) => {
    const r = await readOnce(client, text, c);
    input += r.input; output += r.output; cost += costOf(c.model, r.input, r.output);
    return { note: r.note, ...(r.raw ? verify(r.raw, text.source) : { reading: null, dropped: [] as string[] }) };
  };
  let out = await attempt(cfg);
  if (escalate && needsSecondRead(out.reading, out.dropped)) {
    out = await attempt(escalate);
    model = escalate.model; escalated = true;
  }
  return {
    reading: out.reading, dropped: out.dropped, note: out.note, truncated: text.truncated, model, escalated,
    utility: out.reading?.utility ? matchUtility(out.reading.utility.value, lists.utilities) : null,
    input_tokens: input, output_tokens: output, cost_usd: cost,
  };
}

/** Settings from the environment: MAIL_AI_MODEL (default Claude Haiku 5.5, thinking off) and MAIL_AI_ESCALATE_MODEL (default Claude Sonnet 5.5 at low effort; "none" turns it off). */
export function readConfigFromEnv(): { cfg: ReadConfig; escalate?: ReadConfig } {
  const model = process.env.MAIL_AI_MODEL || 'claude-haiku-5-5';
  const up = process.env.MAIL_AI_ESCALATE_MODEL ?? 'claude-sonnet-5-5';
  return { cfg: { model, thinking: process.env.MAIL_AI_THINKING === 'on', effort: 'low' }, escalate: up && up !== 'none' ? { model: up, thinking: true, effort: 'low' } : undefined };
}
