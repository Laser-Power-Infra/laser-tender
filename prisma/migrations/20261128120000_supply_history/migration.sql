-- Supply history, copied as it is from the tender executive dashboard (database laser-tender-dashboard-v2, table "SupplyHistory").
-- Same name, columns, types and unique key as there, so sync/supply_history_sync.ts can copy rows across without mapping.
-- One row per sale bill and item. The three certificate columns belong to the performance certificate work.
CREATE TABLE "SupplyHistory" (
  "id" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "fy" text,
  "saleBillNumber" text,
  "saleBillDate" text,
  "partyName" text,
  "itemCode" text,
  "itemName" text,
  "lrNo" text,
  "truckNo" text,
  "partyRefNo" text,
  "partyRefDate" text,
  "contractVrNo" text,
  "rate" double precision,
  "invoiceQty" double precision,
  "invoiceAmt" double precision,
  "lastSyncedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "documentUrls" text,
  "attachmentUrl" text,
  "docketNo" text,
  "quotationNo" text,
  "utility" text,
  "contactNo" text,
  "email" text,
  "itemSchedule" text,
  "certificateFileName" text,
  "certificateUrl" text,
  "certificateSentDate" timestamp(3),
  CONSTRAINT "SupplyHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplyHistory_saleBillNumber_itemCode_key" ON "SupplyHistory" ("saleBillNumber", "itemCode");
