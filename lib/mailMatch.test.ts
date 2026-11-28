import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, matchThread, normSubject, partyOf, subjectOverlap, type FeedThread, type KnownEnquiry } from './mailMatch.ts';

const thread = (over: Partial<FeedThread>): FeedThread => ({
  thread_id: 't1', kind: 'incoming', matched_on: ['subject'], date: '2026-11-27 11:00:00', last_updated: '2026-11-27 11:01:00',
  first_from: 'Ravi <ravi@alpha-epc.com>', first_from_email: 'ravi@alpha-epc.com', latest_from: 'Ravi <ravi@alpha-epc.com>', message_froms: ['Ravi <ravi@alpha-epc.com>'],
  to_details: 'enquiry@laserpowerinfra.com', cc_details: '', subject: 'RFQ for LT Cable for Mahape Substation', company: 'Laser', msg_count: 1,
  attach_names: '', attach_links: '', body: '', ...over,
});
const enq = (docket_no: string, email_subject: string, enquiry_from_email: string, party_name: string, enquiry_date = '2026-11-20'): KnownEnquiry =>
  ({ docket_no, email_subject, enquiry_from_email, party_name, enquiry_date });
const TODAY = '2026-11-27';

test('normSubject strips reply and forward prefixes, punctuation and case', () => {
  assert.equal(normSubject('RE: Fwd:  RFQ - LT Cable (Mahape)!'), 'rfq lt cable mahape');
  assert.equal(normSubject(null), '');
});

test('linked: same subject and the same sender address, company domain or party', () => {
  const ix = buildIndex([
    enq('ENQ-1', 'RFQ for LT Cable for Mahape Substation', 'someone.else@alpha-epc.com', 'ALPHA EPC'),
    enq('ENQ-2', 'RFQ for LT Cable for Mahape Substation', 'x@other.com', 'OTHER', '2026-11-25'),
  ], TODAY);
  assert.deepEqual(matchThread(thread({ subject: 'Re: RFQ for LT Cable for Mahape Substation' }), ix), { status: 'linked', docket_no: 'ENQ-1', reason: 'same subject and sender as ENQ-1' });
});

test('review: same subject from another sender, a similar recent subject, or a long conversation we cannot place', () => {
  const ix = buildIndex([
    enq('ENQ-5', 'RFQ for LT Cable for Mahape Substation', 'buyer@gamma.in', 'GAMMA'),
    enq('ENQ-6', 'Purchase enquiry Zebra conductor Navasari Padghe 765kV line', 'p@alpha-epc.com', 'ALPHA EPC'),
    enq('ENQ-7', 'Purchase enquiry Zebra conductor Navasari Padghe 765kV line', 'p@alpha-epc.com', 'ALPHA EPC', '2025-01-01'),
  ], TODAY);
  const sameSubject = matchThread(thread({}), ix);
  assert.equal(sameSubject.status, 'review');
  assert.deepEqual(sameSubject.status === 'review' && sameSubject.candidates, ['ENQ-5']);

  const similar = matchThread(thread({ subject: 'Zebra conductor - Navasari Padghe 765kV - revised BOQ' }), ix);
  assert.deepEqual(similar.status === 'review' && similar.candidates, ['ENQ-6']);      // the 2025 one is too old to count

  const long = matchThread(thread({ subject: 'Earthwire for Sangli package', msg_count: 4 }), ix);
  assert.equal(long.status === 'review' && long.reason, 'ongoing conversation of 4 mails with no matching enquiry');
});

test('new: nothing like it exists; a public mail domain or a short subject never links two parties', () => {
  const ix = buildIndex([
    enq('ENQ-8', 'RFQ for control cables Bhilmi project CSPTCL', 'buyer1@gmail.com', 'BUYER ONE'),
    enq('ENQ-9', 'Quotation', 'ravi@alpha-epc.com', 'ALPHA EPC'),
  ], TODAY);
  assert.deepEqual(matchThread(thread({ subject: 'Enquiry for ACSR Moose - Koradi TPS' }), ix), { status: 'new' });
  assert.deepEqual(matchThread(thread({ first_from_email: 'other@gmail.com', message_froms: ['other@gmail.com'], subject: 'RFQ for control cables Bhilmi project CSPTCL revised qty' }), ix), { status: 'new' });
  assert.deepEqual(matchThread(thread({ subject: 'Quotation' }), ix), { status: 'new' });
});

test('partyOf: address first, then company domain; several parties for one sender is not decided', () => {
  const ix = buildIndex([
    enq('E1', 's1 aaaaaaaaaaaa', 'ravi@alpha-epc.com', 'ALPHA EPC'), enq('E2', 's2 aaaaaaaaaaaa', 'meena@alpha-epc.com', 'ALPHA EPC'),
    enq('E3', 's3 aaaaaaaaaaaa', 'agent@trade.in', 'CLIENT A'), enq('E4', 's4 aaaaaaaaaaaa', 'agent@trade.in', 'CLIENT B'),
    enq('E5', 's5 aaaaaaaaaaaa', 'someone@gmail.com', 'SMALL TRADER'),
  ], TODAY);
  assert.deepEqual(partyOf('ravi@alpha-epc.com', ix), { party: 'ALPHA EPC', candidates: ['ALPHA EPC'], via: 'address' });
  assert.deepEqual(partyOf('new.person@alpha-epc.com', ix), { party: 'ALPHA EPC', candidates: ['ALPHA EPC'], via: 'domain' });
  assert.equal(partyOf('agent@trade.in', ix).party, null);
  assert.deepEqual(partyOf('agent@trade.in', ix).candidates.sort(), ['CLIENT A', 'CLIENT B']);
  assert.deepEqual(partyOf('stranger@gmail.com', ix), { party: null, candidates: [], via: null });
});

test('subjectOverlap ignores filler words', () => {
  assert.equal(subjectOverlap('RFQ for cables', 'Enquiry for conductor'), 0);
  assert.ok(subjectOverlap('Zebra conductor Navasari Padghe', 'Purchase enquiry Zebra conductor Navasari Padghe 765kV') >= 0.7);
});
