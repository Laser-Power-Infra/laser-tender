-- Enquiry mails read from the Email Dashboard feed (GET /api/db-emails/enquiries), one row per mail thread.
-- Guideline 27 Nov 2026, sections 3.1 to 3.3: enquiries are created from the mail, after checking they do not exist already.
CREATE TABLE enquiry_mail (
  thread_id text PRIMARY KEY,                 -- Gmail thread id from the feed
  kind text,                                  -- incoming | forwarded | outgoing
  matched_on text,                            -- where the feed found the enquiry wording
  mail_date timestamp,                        -- latest message of the thread, IST wall clock as the feed gives it
  feed_updated timestamp,
  first_from text,
  first_from_email text,
  latest_from text,
  to_details text,
  cc_details text,
  subject text,
  company text,
  msg_count integer,
  attach_names text,
  attach_links text,
  body text,
  ocr_text text,
  -- what the dashboard decided
  status text NOT NULL CHECK (status IN ('new','created','linked','review','ignored','retired')),
  docket_no text,                             -- the enquiry this mail belongs to (created or linked)
  reason text,                                -- why it has this status, in plain words
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,   -- possible existing dockets, for the review list
  -- the AI reading (at most once per thread unless a person asks again)
  extracted jsonb,
  extract_model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  extracted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_by text
);
CREATE INDEX enquiry_mail_status_idx ON enquiry_mail (status, first_seen_at DESC);
CREATE INDEX enquiry_mail_docket_idx ON enquiry_mail (docket_no);

-- Where each autofilled value of an enquiry came from: { "<column>": { "source": "mail|history|ai", "confidence": "high|medium|low", "note": "..." } }
ALTER TABLE enquiry ADD COLUMN field_source jsonb NOT NULL DEFAULT '{}'::jsonb;
