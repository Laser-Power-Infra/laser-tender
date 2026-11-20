import { prisma } from "@/lib/prisma";

export const TENDER_ALLOCATION_ASSIGNEES = ["PRITIKANA", "RITWICK"] as const;
export const TENDER_ALLOCATION_ACCOUNT_HOLDERS = ["PUJA AGARWAL", "SK TOUHID ALAM"] as const;
export const TENDER_ALLOCATION_CATEGORIES = ["null", "tender", "budgetary", "purchase"] as const;

export type TenderAllocationCategory = (typeof TENDER_ALLOCATION_CATEGORIES)[number];
export type TenderAllocationAssignee = (typeof TENDER_ALLOCATION_ASSIGNEES)[number];

export interface TenderAllocationRow {
  id: string;
  docketNumber: string | null;
  accountHolder: string | null;
  tenderPurchase: string | null;
  allocatedTo: string | null;
}

export interface TenderAllocationAssignment {
  id: string;
  docketNumber: string | null;
  accountHolder: string | null;
  tenderPurchase: string | null;
  category: TenderAllocationCategory;
  before: { allocatedTo: string | null };
  after: { allocatedTo: TenderAllocationAssignee };
}

export interface TenderAllocationPlan {
  totalMatched: number;
  totalUpdated: number;
  byCategory: Record<TenderAllocationCategory, {
    total: number;
    PRITIKANA: number;
    RITWICK: number;
    skipped: number;
  }>;
  rows: TenderAllocationAssignment[];
}

export function classifyTenderPurchase(value: string | null): TenderAllocationCategory {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "null";
  if (normalized.includes("budgetary") || normalized.includes("bugetary")) return "budgetary";
  if (normalized.includes("tender")) return "tender";
  if (normalized.includes("purchase")) return "purchase";
  return "null";
}

function emptyPlan(): TenderAllocationPlan["byCategory"] {
  return {
    null: { total: 0, PRITIKANA: 0, RITWICK: 0, skipped: 0 },
    tender: { total: 0, PRITIKANA: 0, RITWICK: 0, skipped: 0 },
    budgetary: { total: 0, PRITIKANA: 0, RITWICK: 0, skipped: 0 },
    purchase: { total: 0, PRITIKANA: 0, RITWICK: 0, skipped: 0 },
  };
}

function compareDocket(a: TenderAllocationRow, b: TenderAllocationRow): number {
  return (a.docketNumber ?? "").localeCompare(b.docketNumber ?? "", undefined, { numeric: true, sensitivity: "base" })
    || a.id.localeCompare(b.id);
}

export async function createTenderAllocationPlan(): Promise<TenderAllocationPlan> {
  const rows = await prisma.smartsheetTender.findMany({
    where: {
      allocatedTo: null,
      accountHolder: { in: [...TENDER_ALLOCATION_ACCOUNT_HOLDERS] },
    },
    select: { id: true, docketNumber: true, accountHolder: true, tenderPurchase: true, allocatedTo: true },
  }) as TenderAllocationRow[];

  const grouped = new Map<TenderAllocationCategory, TenderAllocationRow[]>(
    TENDER_ALLOCATION_CATEGORIES.map((category) => [category, []]),
  );
  for (const row of rows) grouped.get(classifyTenderPurchase(row.tenderPurchase))!.push(row);
  for (const categoryRows of grouped.values()) categoryRows.sort(compareDocket);

  const byCategory = emptyPlan();
  const assignments: TenderAllocationAssignment[] = [];
  let assignmentIndex = 0;

  for (const category of TENDER_ALLOCATION_CATEGORIES) {
    const categoryRows = grouped.get(category)!;
    byCategory[category].total = categoryRows.length;
    for (const row of categoryRows) {
      const assignee = TENDER_ALLOCATION_ASSIGNEES[assignmentIndex % TENDER_ALLOCATION_ASSIGNEES.length];
      assignmentIndex += 1;
      byCategory[category][assignee] += 1;
      assignments.push({
        id: row.id,
        docketNumber: row.docketNumber,
        accountHolder: row.accountHolder,
        tenderPurchase: row.tenderPurchase,
        category,
        before: { allocatedTo: row.allocatedTo },
        after: { allocatedTo: assignee },
      });
    }
  }

  return { totalMatched: rows.length, totalUpdated: 0, byCategory, rows: assignments };
}

export async function applyTenderAllocationPlan(
  plan: TenderAllocationPlan,
): Promise<TenderAllocationPlan> {
  if (plan.rows.length === 0) return plan;

  const updatedIds = new Set<string>();
  await prisma.$transaction(async (tx) => {
    for (const assignee of TENDER_ALLOCATION_ASSIGNEES) {
      const assignments = plan.rows.filter((row) => row.after.allocatedTo === assignee);
      for (let offset = 0; offset < assignments.length; offset += 100) {
        const batch = assignments.slice(offset, offset + 100);
        const changed = await tx.smartsheetTender.updateMany({
          where: {
            id: { in: batch.map((row) => row.id) },
            allocatedTo: null,
            accountHolder: { in: [...TENDER_ALLOCATION_ACCOUNT_HOLDERS] },
          },
          data: { allocatedTo: assignee, lastSyncedAt: new Date() },
        });
        if (changed.count === batch.length) {
          batch.forEach((row) => updatedIds.add(row.id));
          continue;
        }

        // A concurrent assignment made part of the batch ineligible. Resolve
        // exact IDs individually; still keep each write conditional.
        for (const row of batch) {
          const result = await tx.smartsheetTender.updateMany({
            where: {
              id: row.id,
              allocatedTo: null,
              accountHolder: { in: [...TENDER_ALLOCATION_ACCOUNT_HOLDERS] },
            },
            data: { allocatedTo: assignee, lastSyncedAt: new Date() },
          });
          if (result.count === 1) updatedIds.add(row.id);
        }
      }
    }
  }, { maxWait: 5000, timeout: 30000 });

  const resultRows = plan.rows.map((row) => {
    if (updatedIds.has(row.id)) return row;
    const bucket = plan.byCategory[row.category];
    bucket.skipped += 1;
    bucket[row.after.allocatedTo] -= 1;
    bucket.total -= 1;
    return { ...row, after: { allocatedTo: row.before.allocatedTo as TenderAllocationAssignee } };
  });

  return { ...plan, totalUpdated: updatedIds.size, rows: resultRows };
}
