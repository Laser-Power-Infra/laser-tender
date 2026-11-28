-- Hover summaries of the navigation, editable by Puja (guideline 27 Nov 2026, section 9.7).
-- href = the page's link (for example /reports?tab=type-test) or 'group:<name>' for a navigation group.
-- A page with no row here shows the draft text from lib/pages.ts.
CREATE TABLE page_summary (
  href text PRIMARY KEY,
  text text NOT NULL,
  edited_by text,
  edited_at timestamptz NOT NULL DEFAULT now()
);
