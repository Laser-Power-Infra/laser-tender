// Draft costing of one docket: enquiry_item + typed rate tables -> costing_run / item_costing / rm_detail.
// DRAFT ONLY (BUILD_BRIEF §6): reads enquiry / enquiry_item, never writes them, never touches quotation_no.
import { type Db, inTransaction } from "../sync/lib";
import { costItem, type ItemInput } from "../costing/engine";
import type { ConsumptionSource, RateRow } from "../costing/rules";

export const NO_CONSUMPTION = "consumption not available - ask Soumitra Dey / Soumyashree Samanta";
export const DRAFT_BANNER = "DRAFT for Touhid's review — profit, TTR, special VA and freight are NOT verified against his sheets";

// NON CHAIN BOM RM names equal the DAILY MKT CP column names except for case / repeated spaces.
const RATE_TAB = "DAILY MKT CP";
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const num = (v: unknown) => (v == null ? null : Number(v));

/** Drum cost per km as in Touhid's costings: cost per drum x 1000 / standard length (m)  (e.g. 2724 / 0.5 km = 5448).
 *  Item -> drum + standard length from CIRCULARS "STD DRUM MAP", drum -> cost from "STD DRUM COST" (both read from sheet_snapshot).
 *  Anything missing -> 0 with a note that says what is missing; nothing is assumed. */
async function drumPerKm(db: Db, it: { propose_erp_item: string | null; unit: string | null; party_length: string | null }): Promise<{ perKm: number; note: string }> {
  const zero = (why: string) => ({ perKm: 0, note: `drum cost per unit = 0: ${why}` });
  if (!/^k/i.test(String(it.unit ?? "").trim())) return zero(`item unit "${it.unit ?? ""}" is not km - per-unit conversion not defined`);
  const code = String(it.propose_erp_item ?? "").split("@").pop()!.trim();
  if (!code) return zero("no ERP item code on the line");
  const snap = async (tab: string, key: string, value: string) => (await db.query(
    "SELECT data FROM sheet_snapshot WHERE sheet_key = 'CIRCULARS' AND tab_name = $1 AND btrim(data->>$2) = $3 ORDER BY row_no LIMIT 1", [tab, key, value])).rows[0]?.data as Record<string, string> | undefined;
  const map = await snap("STD DRUM MAP", "ITEM CODE", code);
  if (!map) return zero(`item ${code} not in STD DRUM MAP`);
  const drumCode = String(map["DRUM CODE"] ?? "").trim(), len = Number(String(map["STD LENGTH (M)"] ?? "").replace(/,/g, ""));
  const cost = await snap("STD DRUM COST", "DRUM CODE", drumCode);
  const perDrum = Number(String(cost?.["DRUM COST PER DRUM (Rs)"] ?? "").replace(/,/g, ""));
  if (!drumCode || !(len > 0)) return zero(`STD DRUM MAP has no drum / standard length for item ${code}`);
  if (!cost || !(perDrum > 0)) return zero(`drum ${drumCode} has no cost in STD DRUM COST`);
  const perKm = Math.round((perDrum * 1000 / len) * 100) / 100;
  const party = String(it.party_length ?? "").trim();
  return { perKm, note: `drum cost/km ${perKm} = drum ${drumCode} Rs ${perDrum} x 1000 / std length ${len} m (STD DRUM MAP + STD DRUM COST; cost source: ${cost["COST SOURCE"] ?? "?"})`
    + (party ? `; PARTY LENGTH "${party}" is set on the line - verify the drum and length` : "") };
}

export interface DraftResult { runId: number; docketNo: string; revision: number; warnings: string[] }

export async function draftCosting(db: Db, docketNo: string, actor: string, today: string): Promise<DraftResult> {
  const items = (await db.query(
    `SELECT id, propose_erp_item, qty, unit, freight, gst_pct, mfg_pct, prof_pct, intt_pct, insp_pct, ttr_charges_pct,
            special_value_addition_pct, special_rate_approval_dvg, actual_non_chain_bom_id, duplicate_item, party_length, destination_pin_code,
            to_char(base_date, 'YYYY-MM-DD') AS base_date
       FROM enquiry_item WHERE docket_no = $1 AND deleted_at IS NULL ORDER BY id`, [docketNo])).rows;
  if (!items.length) throw new Error(`No live items for docket ${docketNo}`);

  // FIRM -> today's rates; price variation -> rates on the item's Base Date; not stated -> firm (COSTING_RULES §3).
  const basis: string | null = (await db.query("SELECT price_basis FROM enquiry WHERE docket_no = $1", [docketNo])).rows[0]?.price_basis ?? null;
  const rmPolicy = /variation|\bpv\b/i.test(basis ?? "") ? "PV" as const : "FIRM" as const;
  const baseDates = [...new Set(items.map(i => i.base_date).filter(Boolean))];

  return inTransaction(db, async () => {
    const rev = Number((await db.query("SELECT coalesce(max(revision), 0) + 1 AS n FROM costing_run WHERE docket_no = $1", [docketNo])).rows[0].n);
    const runId = Number((await db.query(
      `INSERT INTO costing_run (docket_no, revision, status, rm_rate_policy, rm_base_date, created_by) VALUES ($1, $2, 'DRAFT', $3, $4, $5) RETURNING id`,
      [docketNo, rev, rmPolicy, rmPolicy === "PV" && baseDates.length === 1 ? baseDates[0] : null, actor])).rows[0].id);
    const allWarnings: string[] = [];

    for (const [n, it] of items.entries()) {
      const itCode = `IT${String(n + 1).padStart(3, "0")}`;
      const bomId = String(it.actual_non_chain_bom_id ?? "").trim();
      const bom = bomId ? (await db.query("SELECT rm_name, consumption, unit FROM non_chain_bom WHERE bom_id = $1 ORDER BY rm_name", [bomId])).rows : [];
      const warnings: string[] = [];
      if (String(it.duplicate_item ?? "").trim()) warnings.push(`item line is marked DUPLICATE ITEM ("${it.duplicate_item}") - do not count twice`);

      let inputs: object = { item: it, today }, out: ReturnType<typeof costItem> | null = null;
      if (!bom.length) {
        warnings.push(NO_CONSUMPTION);
      } else {
        const baseDate: string | null = it.base_date;
        // Latest rate on/before the target date per RM (the engine applies the same rule; this keeps the stored inputs small).
        const rates = (await db.query(
          `SELECT DISTINCT ON (rm_name) rm_name, to_char(rate_date, 'YYYY-MM-DD') AS rate_date, rate FROM rm_rate
            WHERE source_tab = $1 AND rate_date <= $2::date
              AND lower(regexp_replace(btrim(rm_name), '\\s+', ' ', 'g')) IN (SELECT jsonb_array_elements_text($3::jsonb))
            ORDER BY rm_name, rate_date DESC`,
          [RATE_TAB, rmPolicy === "PV" && baseDate ? baseDate : today, JSON.stringify(bom.map(l => norm(l.rm_name)))])).rows;
        const rmRates: RateRow[] = rates.map(r => ({ rate_date: r.rate_date, rate: Number(r.rate), rm_name: bom.find(l => norm(l.rm_name) === norm(r.rm_name))!.rm_name }));

        const pct = { mfg: num(it.mfg_pct), profit: num(it.prof_pct), insp: num(it.insp_pct), ttr: num(it.ttr_charges_pct), gst: num(it.gst_pct) };
        const blank = Object.entries(pct).filter(([, v]) => v == null).map(([k]) => k);
        if (blank.length) warnings.push(`blank % column(s) taken as 0: ${blank.join(", ")}`);

        const approved = String(it.special_rate_approval_dvg ?? "").trim().toUpperCase() === "YES";
        const va = num(it.special_value_addition_pct);
        if (va != null && !approved) warnings.push(`Special VA % ${va} NOT applied: no DVG approval`);

        const drum = await drumPerKm(db, it);

        // Item-list Intt % is a fraction; the engine wants credit days (1 % per 30 days).
        const intt = num(it.intt_pct);
        if (intt == null) warnings.push("Intt % blank: interest 0 used - the default rule (< Rs 50 lakh advance / above = 60-day LC) is NOT applied, check payment terms");

        warnings.push(
          `RM rate policy ${rmPolicy} (enquiry price basis: ${basis ?? "not stated"}); rates from ${RATE_TAB}`,
          `consumption taken as-is from NON CHAIN BOM ${bomId} (the sheet states no unit / per-what basis) - verify against item unit ${it.unit ?? "?"}`,
          "markup order follows Touhid's sheets for MFG, Intt, Insp and GST; placement of PROF %, TTR % and special VA % is NOT verified (no costing uses them)",
          `freight per unit = 0: full-truck to per-unit conversion is an open question (OPEN_QUESTIONS Q10)${it.freight != null ? `; item-list freight ${Number(it.freight)} NOT applied` : ""}`,
          drum.note,
        );
        // Guideline 3.5 step 5 as changed on 27 Nov 2026 (Puja still to confirm, 9.8 F): no delivery location no longer means ex-works.
        // The only delivery field today is the item line's Destination PIN Code.
        if (!String(it.destination_pin_code ?? "").trim())
          warnings.push("delivery location not recorded: freight not costed - hold the offer until the location is confirmed (do not treat as ex-works unless the enquiry says so)");

        const input: ItemInput = {
          qty: num(it.qty) ?? 0, unit: it.unit ?? "",
          rmLines: bom.map(l => ({
            rm_name: l.rm_name, consumption: Number(l.consumption), unit: l.unit ?? undefined,
            // The engine's source list has no entry for the actual BOM; label it truthfully (rm_detail.consumption_source is text).
            source: "NON_CHAIN_BOM" as ConsumptionSource,
            source_ref: `MASTER_BOM_ACTUAL / NON CHAIN BOM, BOM Code ${bomId}`,
            formula: `consumption = NON CHAIN BOM ${bomId}, column "${l.rm_name}"`,
          })),
          rmRates, rmPolicy, baseDate, today,
          drumCostPerUnit: drum.perKm, freightPerUnit: 0,
          pct: { mfg: pct.mfg ?? 0, profit: pct.profit ?? 0, insp: pct.insp ?? 0, ttr: pct.ttr ?? 0, gst: pct.gst ?? 0 },
          interest: { statedCreditDays: Math.round((intt ?? 0) * 3000 * 1e6) / 1e6, orderValueRupees: 0 },
          specialVaPct: approved ? va : null,
        };
        out = costItem(input);
        inputs = { ...input, item: it };
        warnings.unshift(...out.warnings);
      }

      const icId = (await db.query(
        `INSERT INTO item_costing (run_id, item_id, it_code, erp_item, qty, unit, bom_id, bom_match_note,
                                   rm_cost, drum_cost, freight, ex_works, price_ex_gst, gst, price_incl_gst, inputs, breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb) RETURNING id`,
        [runId, it.id, itCode, it.propose_erp_item, it.qty, it.unit, bomId || null,
          out ? null : bomId ? `BOM ${bomId} not found in NON CHAIN BOM` : "no ACTUAL NON CHAIN BOM ID",
          // an RM without a rate would understate every price: keep the RM detail, store no totals
          ...(out && out.rm_detail.every(d => d.amount != null)
            ? [out.rm_cost, out.drum_cost, out.freight, out.ex_works, out.price_ex_gst, out.gst, out.price_incl_gst]
            : [null, null, null, null, null, null, null]),
          JSON.stringify(inputs), JSON.stringify({ ...out, warnings })])).rows[0].id;
      for (const d of out?.rm_detail ?? []) {
        await db.query(
          `INSERT INTO rm_detail (item_costing_id, rm_name, consumption, unit, rate, rate_date, amount, consumption_source, source_ref, formula)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [icId, d.rm_name, d.consumption, d.unit ?? null, d.rate, d.rate_date, d.amount, d.consumption_source, d.source_ref, `${d.formula} | rate: ${d.rate_note}`]);
      }
      allWarnings.push(...warnings.map(w => `${itCode}: ${w}`));
    }
    return { runId, docketNo, revision: rev, warnings: allWarnings };
  });
}

export interface RmDetailView { rm_name: string; consumption: string; unit: string | null; rate: string | null; rate_date: string | null; amount: string | null; consumption_source: string; source_ref: string | null; formula: string | null }
export interface ItemCostingView {
  id: string; it_code: string; erp_item: string | null; qty: string | null; unit: string | null; bom_id: string | null; bom_match_note: string | null;
  rm_cost: string | null; drum_cost: string | null; freight: string | null; ex_works: string | null; price_ex_gst: string | null; gst: string | null; price_incl_gst: string | null;
  warnings: string[]; rm: RmDetailView[];
}
export interface CostingRunView { id: string; docket_no: string; revision: number; status: string; rm_rate_policy: string; rm_base_date: string | null; created_by: string | null; created_at: string; items: ItemCostingView[] }

/** Runs of a docket (by = "docket_no") or one run (by = "id"), latest revision first, with items and RM detail. */
export async function readCostingRuns(db: Db, by: "docket_no" | "id", value: string): Promise<CostingRunView[]> {
  const runs: CostingRunView[] = (await db.query(
    `SELECT id::text, docket_no, revision, status::text, rm_rate_policy, to_char(rm_base_date, 'YYYY-MM-DD') AS rm_base_date, created_by,
            to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM costing_run WHERE ${by}::text = $1 ORDER BY revision DESC`, [value])).rows;
  for (const r of runs) {
    r.items = (await db.query(
      `SELECT id::text, it_code, erp_item, qty::text, unit, bom_id, bom_match_note, rm_cost::text, drum_cost::text, freight::text, ex_works::text,
              price_ex_gst::text, gst::text, price_incl_gst::text, coalesce(breakdown->'warnings', '[]'::jsonb) AS warnings
         FROM item_costing WHERE run_id = $1 ORDER BY id`, [r.id])).rows;
    for (const it of r.items) {
      it.rm = (await db.query(
        `SELECT rm_name, consumption::text, unit, rate::text, to_char(rate_date, 'YYYY-MM-DD') AS rate_date, amount::text, consumption_source, source_ref, formula
           FROM rm_detail WHERE item_costing_id = $1 ORDER BY id`, [it.id])).rows;
    }
  }
  return runs;
}
