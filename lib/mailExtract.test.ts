import test from 'node:test';
import assert from 'node:assert/strict';
import { costOf, matchUtility, needsSecondRead, proven, readMail, verify, type MailReading, type MessagesClient } from './mailExtract.ts';
import type { FeedThread } from './mailMatch.ts';

const SOURCE = 'RFQ No.: ALP/RFQ/2026/118 dated 26.11.2026\nOffers to reach us by 05-Dec-2026.\n1) 11kV 3C x 300 sqmm XLPE cable - 12.5 KM\nEnd client: OPTCL\nContact: 98300 12345';
const reading = (over: Partial<MailReading> = {}): MailReading => ({
  mail_type: 'new_enquiry', product: 'cables_or_conductors', type_confidence: 'high', summary: 'Alpha asks for HT cable.', party_company: 'Alpha EPC', category: 'Purchase', category_confidence: 'medium',
  party_enquiry_no: { value: 'ALP/RFQ/2026/118', quote: 'RFQ No.: ALP/RFQ/2026/118' }, due_date: { value: '2026-12-05', quote: 'Offers to reach us by 05-Dec-2026' },
  utility: { value: 'OPTCL', quote: 'End client: OPTCL' }, project_name: null, contact_person: 'Ravi', contact_no: { value: '9830012345', quote: 'Contact: 98300 12345' },
  gtp_required: null, csd_required: null, drum_drawing_required: null, type_test_required: null, sample_required: null, terms: null,
  items: [{ name: '11kV 3C x 300 sqmm XLPE cable', qty: 12.5, unit: 'KM', quote: '11kV 3C x 300 sqmm XLPE cable - 12.5 KM' }], ...over,
});
const thread: FeedThread = {
  thread_id: 't1', kind: 'incoming', matched_on: ['subject'], date: '2026-11-27 11:00:00', last_updated: '2026-11-27 11:01:00', first_from: 'Ravi <ravi@alpha-epc.com>', first_from_email: 'ravi@alpha-epc.com',
  latest_from: '', message_froms: [], to_details: 'enquiry@laserpowerinfra.com', cc_details: '', subject: 'RFQ for HT cable', company: 'Laser', msg_count: 1, attach_names: '', attach_links: '', body: SOURCE, ocr_text: '',
};

test('proven: the quote must be in the mail (spacing and case ignored) and contain the value', () => {
  assert.ok(proven('rfq no.:   ALP/RFQ/2026/118', SOURCE, 'ALP/RFQ/2026/118'));
  assert.ok(proven('Contact: 98300 12345', SOURCE, '9830012345'));             // value compared on letters and digits only
  assert.ok(!proven('RFQ No.: ALP/RFQ/2026/119', SOURCE, 'ALP/RFQ/2026/119')); // not in the mail
  assert.ok(!proven('RFQ No.: ALP/RFQ/2026/118', SOURCE, 'ALP/RFQ/2026/999')); // quote real, value not in it
  assert.ok(!proven('5', SOURCE));                                             // too short to prove anything
});

test('verify keeps proven values and drops the rest, naming what was dropped', () => {
  assert.deepEqual(verify(reading(), SOURCE).dropped, []);
  const bad = verify(reading({
    party_enquiry_no: { value: 'ALP/RFQ/2026/999', quote: 'RFQ No.: ALP/RFQ/2026/999' },
    due_date: { value: '05/12/2026', quote: 'Offers to reach us by 05-Dec-2026' },                       // not YYYY-MM-DD
    items: [reading().items[0], { name: '33kV cable', qty: 4, unit: 'KM', quote: '33kV cable - 4 KM' }],  // second line is invented
  }), SOURCE);
  assert.deepEqual(bad.dropped, ['due_date', 'item: 33kV cable', 'party_enquiry_no']);
  assert.deepEqual([bad.reading.party_enquiry_no, bad.reading.due_date, bad.reading.items.length, bad.reading.contact_no?.value], [null, null, 1, '9830012345']);
});

test('matchUtility: exact name, bracketed abbreviation or contained name; nothing when unclear', () => {
  const list = ['ODISHA POWER TRANSMISSION CORPORATION LIMITED (OPTCL)', 'Power & Electricity Department- Mizoram (PEDM)', 'TP Western Odisha Distribution Ltd (TPWODL)', 'TP Central Odisha Distribution Ltd (TPCODL)'];
  assert.equal(matchUtility('OPTCL', list), list[0]);
  assert.equal(matchUtility('Odisha Power Transmission Corporation Limited', list), list[0]);
  assert.equal(matchUtility('TP Western Odisha Distribution Ltd', list), list[2]);
  assert.equal(matchUtility('Odisha Distribution', list), null);     // two entries contain it
  assert.equal(matchUtility('Some Unknown Board', list), null);
});

test('readMail: one cheap read when it passes its checks; a second, stronger read only when it does not', async () => {
  const calls: string[] = [];
  const fake = (answers: Record<string, MailReading | null>): MessagesClient => ({
    messages: { parse: async (p: { model: string }) => { calls.push(p.model); return { stop_reason: answers[p.model] ? 'end_turn' : 'refusal', parsed_output: answers[p.model], usage: { input_tokens: 1000, output_tokens: 200 } }; } },
  }) as unknown as MessagesClient;
  const lists = { utilities: ['ODISHA POWER TRANSMISSION CORPORATION LIMITED (OPTCL)'] };
  const cheap = { model: 'claude-haiku-5-5', thinking: false }, strong = { model: 'claude-sonnet-5-5', thinking: true, effort: 'low' as const };

  const ok = await readMail(fake({ 'claude-haiku-5-5': reading() }), thread, lists, '2026-11-27', cheap, strong);
  assert.deepEqual([calls.splice(0), ok.escalated, ok.model, ok.utility, ok.input_tokens], [['claude-haiku-5-5'], false, 'claude-haiku-5-5', lists.utilities[0], 1000]);
  assert.equal(ok.cost_usd, costOf('claude-haiku-5-5', 1000, 200));

  const unsure = reading({ party_enquiry_no: { value: 'X-1', quote: 'RFQ No.: X-1' } });           // proof fails on a key field
  const up = await readMail(fake({ 'claude-haiku-5-5': unsure, 'claude-sonnet-5-5': reading() }), thread, lists, '2026-11-27', cheap, strong);
  assert.deepEqual([calls.splice(0), up.escalated, up.model, up.dropped, up.input_tokens], [['claude-haiku-5-5', 'claude-sonnet-5-5'], true, 'claude-sonnet-5-5', [], 2000]);
  assert.equal(up.cost_usd, costOf('claude-haiku-5-5', 1000, 200) + costOf('claude-sonnet-5-5', 1000, 200));

  const declined = await readMail(fake({ 'claude-haiku-5-5': null }), thread, lists, '2026-11-27', cheap);   // no stronger model configured
  assert.deepEqual([declined.reading, declined.note, calls.splice(0)], [null, 'model stopped with "refusal"', ['claude-haiku-5-5']]);
});

test('needsSecondRead: low confidence on what the mail is, or a failed proof on the enquiry number or due date', () => {
  assert.equal(needsSecondRead(reading(), []), false);
  assert.equal(needsSecondRead(reading(), ['contact_no', 'item: x']), false);
  assert.equal(needsSecondRead(reading({ type_confidence: 'low' }), []), true);
  assert.equal(needsSecondRead(reading(), ['due_date']), true);
  assert.equal(needsSecondRead(null, []), true);
});
