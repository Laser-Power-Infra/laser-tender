import { prisma } from "../lib/prisma";
import { findCostingFileRecursive, extractNumericDocket, encryptStoredPath, buildStoredPath } from "./costingFileFinder.mjs";

const cleanFloat = (val) => {
  if (val === null || val === undefined || val === "") return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : num;
};

const isNullishForSync = (val) => val === null || val === undefined || val === "";

const isRecordModified = (sheet, db) => {
  const fields = [
    { name: "enquiryDate", type: "string" },
    { name: "partyName", type: "string" },
    { name: "docketNumber", type: "string" },
    { name: "utility", type: "string" },
    { name: "quotationNumber", type: "string" },
    { name: "quotationDate", type: "string" },
    { name: "accountHolder", type: "string" },
    // { name: "allocatedTo", type: "string" },
    // { name: "status", type: "string" },
    // { name: "contactNo", type: "string" },
    // { name: "emailId", type: "string" },
    // { name: "emailSubjectLine", type: "string" },
    { name: "reverseAuctionApplicable", type: "string" },
    { name: "tenderPurchase", type: "string" },
    { name: "attachmentUrl", type: "string" },
    { name: "proposedErpItemName", type: "string" },
    { name: "proposedQty", type: "string" },
    { name: "priceBasis", type: "string" },
    { name: "contractNo", type: "string" },
    { name: "aluminiumPrice", type: "float" },
    { name: "aluminiumAlloyPrice", type: "float" },
    { name: "copperTapePrice", type: "float" },
    { name: "extrudedSemiconductivePrice", type: "float" },
    { name: "htXlpePrice", type: "float" },
    { name: "pvcTypeSt2Price", type: "float" },
    { name: "galvanisedSteelFlatStripPrice", type: "float" },
    { name: "fillerPrice", type: "float" },
  ];

  for (const field of fields) {
    let sheetVal = sheet[field.name];
    let dbVal = db[field.name];

    // Sync must never clear: if sheet doesn't provide a value, don't treat as modified
    if (isNullishForSync(sheetVal)) {
      continue;
    }

    if (field.type === "float") {
      const v1 = sheetVal !== null && sheetVal !== undefined && sheetVal !== "" ? parseFloat(sheetVal) : null;
      const v2 = dbVal !== null && dbVal !== undefined && dbVal !== "" ? parseFloat(dbVal) : null;
      const isV1NaN = v1 === null || isNaN(v1);
      const isV2NaN = v2 === null || isNaN(v2);
      if (isV1NaN && isV2NaN) continue;
      if (isV1NaN || isV2NaN || v1 !== v2) return true;
    } else {
      const v1 = (sheetVal || "").toString().trim();
      const v2 = (dbVal || "").toString().trim();
      if (v1 !== v2) return true;
    }
  }

  // ContactNo / EmailId / EmailSubjectLine: fill nulls only — sheet fills DB only when DB is nullish (editable preserves local edits)
  if (!isNullishForSync(sheet.contactNo) && isNullishForSync(db.contactNo)) return true;
  if (!isNullishForSync(sheet.emailId) && isNullishForSync(db.emailId)) return true;
  if (!isNullishForSync(sheet.emailSubjectLine) && isNullishForSync(db.emailSubjectLine)) return true;

  return false;
};

export class DatabaseSmartsheetService {
  /**
   * Upsert a list of Smartsheet tenders to PostgreSQL.
   */
  static async upsertSmartsheetTenders(records) {
    if (!prisma) {
      console.warn("[DatabaseSmartsheetService] Prisma client unavailable; skipping database sync.");
      return { success: false, reason: "Prisma client unavailable" };
    }

    // Filter records that have a valid docketNumber
    const validRecords = records.filter(r => r.docketNumber && r.docketNumber.trim() !== "");

    if (validRecords.length === 0) {
      console.log("[DatabaseSmartsheetService] No valid Smartsheet records with docket number found for sync.");
      return { success: true, inserted: 0, updated: 0, skipped: 0 };
    }

    console.log(`[DatabaseSmartsheetService] Starting DB sync for ${validRecords.length} records...`);

    try {
      // Fetch all existing database records to compare
      const existingList = await prisma.smartsheetTender.findMany();
      const existingMap = new Map();
      existingList.forEach(item => {
        if (item.docketNumber) {
          existingMap.set(item.docketNumber.trim(), item);
        }
      });

      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const record of validRecords) {
        const docketKey = record.docketNumber.trim();
        const dbRecord = existingMap.get(docketKey);

        const buildCreateData = () => ({
          enquiryDate: record.enquiryDate || null,
          partyName: record.partyName || null,
          docketNumber: docketKey,
          utility: record.utility || null,
          quotationNumber: record.quotationNumber || null,
          quotationDate: record.quotationDate || null,
          accountHolder: record.accountHolder || null,
          reverseAuctionApplicable: record.reverseAuctionApplicable || null,
          tenderPurchase: record.tenderPurchase || null,
          attachmentUrl: record.attachmentUrl || null,
          proposedErpItemName: record.proposedErpItemName || null,
          proposedQty: record.proposedQty || null,
          priceBasis: record.priceBasis || null,
          contractNo: record.contractNo || null,
          emailId: record.emailId || null,
          emailSubjectLine: record.emailSubjectLine || null,
          contactNo: record.contactNo || null,
          aluminiumPrice: cleanFloat(record.aluminiumPrice),
          aluminiumAlloyPrice: cleanFloat(record.aluminiumAlloyPrice),
          copperTapePrice: cleanFloat(record.copperTapePrice),
          extrudedSemiconductivePrice: cleanFloat(record.extrudedSemiconductivePrice),
          htXlpePrice: cleanFloat(record.htXlpePrice),
          pvcTypeSt2Price: cleanFloat(record.pvcTypeSt2Price),
          galvanisedSteelFlatStripPrice: cleanFloat(record.galvanisedSteelFlatStripPrice),
          fillerPrice: cleanFloat(record.fillerPrice),
          lastSyncedAt: new Date(),
        });

        const buildUpdateData = () => {
          const data = { lastSyncedAt: new Date() };
          if (!isNullishForSync(record.enquiryDate)) data.enquiryDate = record.enquiryDate;
          if (!isNullishForSync(record.partyName)) data.partyName = record.partyName;
          if (!isNullishForSync(record.utility)) data.utility = record.utility;
          if (!isNullishForSync(record.quotationNumber)) data.quotationNumber = record.quotationNumber;
          if (!isNullishForSync(record.quotationDate)) data.quotationDate = record.quotationDate;
          if (!isNullishForSync(record.accountHolder)) data.accountHolder = record.accountHolder;
          if (!isNullishForSync(record.reverseAuctionApplicable)) data.reverseAuctionApplicable = record.reverseAuctionApplicable;
          if (!isNullishForSync(record.tenderPurchase)) data.tenderPurchase = record.tenderPurchase;
          if (!isNullishForSync(record.attachmentUrl)) data.attachmentUrl = record.attachmentUrl;
          if (!isNullishForSync(record.proposedErpItemName)) data.proposedErpItemName = record.proposedErpItemName;
          if (!isNullishForSync(record.proposedQty)) data.proposedQty = record.proposedQty;
          if (!isNullishForSync(record.priceBasis)) data.priceBasis = record.priceBasis;
          if (!isNullishForSync(record.contractNo)) data.contractNo = record.contractNo;
          if (!isNullishForSync(record.emailId) && isNullishForSync(dbRecord?.emailId)) data.emailId = record.emailId;
          if (!isNullishForSync(record.emailSubjectLine) && isNullishForSync(dbRecord?.emailSubjectLine)) data.emailSubjectLine = record.emailSubjectLine;
          if (!isNullishForSync(record.contactNo) && isNullishForSync(dbRecord?.contactNo)) data.contactNo = record.contactNo;
          const ap = cleanFloat(record.aluminiumPrice);
          if (ap !== null) data.aluminiumPrice = ap;
          const aap = cleanFloat(record.aluminiumAlloyPrice);
          if (aap !== null) data.aluminiumAlloyPrice = aap;
          const ctp = cleanFloat(record.copperTapePrice);
          if (ctp !== null) data.copperTapePrice = ctp;
          const esp = cleanFloat(record.extrudedSemiconductivePrice);
          if (esp !== null) data.extrudedSemiconductivePrice = esp;
          const htp = cleanFloat(record.htXlpePrice);
          if (htp !== null) data.htXlpePrice = htp;
          const pvc = cleanFloat(record.pvcTypeSt2Price);
          if (pvc !== null) data.pvcTypeSt2Price = pvc;
          const gssp = cleanFloat(record.galvanisedSteelFlatStripPrice);
          if (gssp !== null) data.galvanisedSteelFlatStripPrice = gssp;
          const fp = cleanFloat(record.fillerPrice);
          if (fp !== null) data.fillerPrice = fp;
          return data;
        };

        if (!dbRecord) {
          try {
            await prisma.smartsheetTender.create({ data: buildCreateData() });
            insertedCount++;
          } catch (err) {
            console.error(`❌ CREATE FAILURE for Smartsheet tender: ${docketKey}`, err.message || err);
          }
        } else if (isRecordModified(record, dbRecord)) {
          try {
            await prisma.smartsheetTender.update({
              where: { id: dbRecord.id },
              data: buildUpdateData(),
            });
            updatedCount++;
          } catch (err) {
            console.error(`❌ UPDATE FAILURE for Smartsheet tender: ${docketKey}`, err);
          }
        } else {
          skippedCount++;
        }
      }

      console.log(`[DatabaseSmartsheetService] Sync Complete: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped.`);
      return { success: true, inserted: insertedCount, updated: updatedCount, skipped: skippedCount };
    } catch (err) {
      console.error("[DatabaseSmartsheetService] Sync pipeline failed:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Updates the allocatedTo field for a single Smartsheet tender by docketNumber.
   */
  static async updateSmartsheetTenderAllocatedTo(docketNumber, allocatedTo) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { allocatedTo, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async batchUpdateSmartsheetTenderAllocatedTo(docketNumbers, allocatedTo) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const result = await prisma.smartsheetTender.updateMany({
        where: { docketNumber: { in: docketNumbers } },
        data: { allocatedTo, lastSyncedAt: new Date() },
      });
      return { success: true, updatedCount: result.count };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderStatus(docketNumber, status) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { status, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderReverseAuction(docketNumber, value) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { reverseAuctionApplicable: value, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderContactNo(docketNumber, contactNo) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { contactNo, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderEmailId(docketNumber, emailId) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { emailId, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderEmailSubjectLine(docketNumber, emailSubjectLine) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { emailSubjectLine, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  static async updateSmartsheetTenderLostStillScope(docketNumber, value) {
    if (!prisma) {
      return { success: false, error: "Prisma client unavailable" };
    }
    try {
      const existing = await prisma.smartsheetTender.findUnique({
        where: { docketNumber },
      });
      if (!existing) {
        return { success: false, error: "Record not found" };
      }
      // Guard: if contractNo present, this column is derived as Awarded and should not be manually changed
      // But allow clearing? UI will block Awarded rows; this is extra safety — still allow updates if caller insists
      const normalized = value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim();
      // Only allow Lost / Still Scope / null
      if (normalized !== null && normalized !== "Lost" && normalized !== "Still Scope") {
        return { success: false, error: "Invalid value. Allowed: Lost, Still Scope" };
      }
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { LostStillScope: normalized, lastSyncedAt: new Date() },
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Bulk upsert using batched transactions (much faster than individual create/update).
   */
  static async bulkUpsertSmartsheetTenders(records) {
    if (!prisma) {
      return { success: false, reason: "Prisma client unavailable" };
    }

    const validRecords = records.filter(r => r.docketNumber && r.docketNumber.trim() !== "");
    if (validRecords.length === 0) {
      return { success: true, inserted: 0, updated: 0, skipped: 0 };
    }

    const BATCH_SIZE = 100;
    let inserted = 0;
    let updated = 0;
    const insertedLog = [];
    const updatedLog = [];
    const MAX_LOG = 20;

    // For Option A: contactNo/emailId/emailSubjectLine fill nulls only — need existing values map
    const existingForEditable = await prisma.smartsheetTender.findMany({ select: { docketNumber: true, contactNo: true, emailId: true, emailSubjectLine: true } });
    const existingEditableMap = new Map();
    existingForEditable.forEach(item => { if (item.docketNumber) existingEditableMap.set(item.docketNumber.trim(), item); });

    for (let i = 0; i < validRecords.length; i += BATCH_SIZE) {
      const batch = validRecords.slice(i, i + BATCH_SIZE);
      const ops = batch.map(record => {
        const docketKey = record.docketNumber.trim();
        const commonData = {
          enquiryDate: record.enquiryDate || null,
          partyName: record.partyName || null,
          docketNumber: docketKey,
          utility: record.utility || null,
          quotationNumber: record.quotationNumber || null,
          quotationDate: record.quotationDate || null,
          accountHolder: record.accountHolder || null,
          reverseAuctionApplicable: record.reverseAuctionApplicable || null,
          tenderPurchase: record.tenderPurchase || null,
          attachmentUrl: record.attachmentUrl || null,
          proposedErpItemName: record.proposedErpItemName || null,
          proposedQty: record.proposedQty || null,
          priceBasis: record.priceBasis || null,
          contractNo: record.contractNo || null,
          emailId: record.emailId || null,
          emailSubjectLine: record.emailSubjectLine || null,
          contactNo: record.contactNo || null,
          aluminiumPrice: cleanFloat(record.aluminiumPrice),
          aluminiumAlloyPrice: cleanFloat(record.aluminiumAlloyPrice),
          copperTapePrice: cleanFloat(record.copperTapePrice),
          extrudedSemiconductivePrice: cleanFloat(record.extrudedSemiconductivePrice),
          htXlpePrice: cleanFloat(record.htXlpePrice),
          pvcTypeSt2Price: cleanFloat(record.pvcTypeSt2Price),
          galvanisedSteelFlatStripPrice: cleanFloat(record.galvanisedSteelFlatStripPrice),
          fillerPrice: cleanFloat(record.fillerPrice),
          lastSyncedAt: new Date(),
        };
        const createData = { ...commonData };
        const updateData = { lastSyncedAt: new Date() };
        if (!isNullishForSync(record.enquiryDate)) updateData.enquiryDate = record.enquiryDate;
        if (!isNullishForSync(record.partyName)) updateData.partyName = record.partyName;
        if (!isNullishForSync(record.utility)) updateData.utility = record.utility;
        if (!isNullishForSync(record.quotationNumber)) updateData.quotationNumber = record.quotationNumber;
        if (!isNullishForSync(record.quotationDate)) updateData.quotationDate = record.quotationDate;
        if (!isNullishForSync(record.accountHolder)) updateData.accountHolder = record.accountHolder;
        if (!isNullishForSync(record.reverseAuctionApplicable)) updateData.reverseAuctionApplicable = record.reverseAuctionApplicable;
        if (!isNullishForSync(record.tenderPurchase)) updateData.tenderPurchase = record.tenderPurchase;
        if (!isNullishForSync(record.attachmentUrl)) updateData.attachmentUrl = record.attachmentUrl;
        if (!isNullishForSync(record.proposedErpItemName)) updateData.proposedErpItemName = record.proposedErpItemName;
        if (!isNullishForSync(record.proposedQty)) updateData.proposedQty = record.proposedQty;
        if (!isNullishForSync(record.priceBasis)) updateData.priceBasis = record.priceBasis;
        if (!isNullishForSync(record.contractNo)) updateData.contractNo = record.contractNo;
        const existingEditable = existingEditableMap.get(docketKey);
        if (!isNullishForSync(record.emailId) && isNullishForSync(existingEditable?.emailId)) updateData.emailId = record.emailId;
        if (!isNullishForSync(record.emailSubjectLine) && isNullishForSync(existingEditable?.emailSubjectLine)) updateData.emailSubjectLine = record.emailSubjectLine;
        if (!isNullishForSync(record.contactNo) && isNullishForSync(existingEditable?.contactNo)) updateData.contactNo = record.contactNo;
        const ap = cleanFloat(record.aluminiumPrice);
        if (ap !== null) updateData.aluminiumPrice = ap;
        const aap = cleanFloat(record.aluminiumAlloyPrice);
        if (aap !== null) updateData.aluminiumAlloyPrice = aap;
        const ctp = cleanFloat(record.copperTapePrice);
        if (ctp !== null) updateData.copperTapePrice = ctp;
        const esp = cleanFloat(record.extrudedSemiconductivePrice);
        if (esp !== null) updateData.extrudedSemiconductivePrice = esp;
        const htp = cleanFloat(record.htXlpePrice);
        if (htp !== null) updateData.htXlpePrice = htp;
        const pvc = cleanFloat(record.pvcTypeSt2Price);
        if (pvc !== null) updateData.pvcTypeSt2Price = pvc;
        const gssp = cleanFloat(record.galvanisedSteelFlatStripPrice);
        if (gssp !== null) updateData.galvanisedSteelFlatStripPrice = gssp;
        const fp = cleanFloat(record.fillerPrice);
        if (fp !== null) updateData.fillerPrice = fp;
        return { docketKey, partyName: record.partyName, promise: prisma.smartsheetTender.upsert({
          where: { docketNumber: docketKey },
          create: createData,
          update: updateData,
        }) };
      });

      const withPromises = ops.map(op => op.promise);
      const results = await prisma.$transaction(withPromises, { maxWait: 5000, timeout: 30000 });
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        const op = ops[j];
        if (r.createdAt === r.updatedAt) {
          inserted++;
          if (insertedLog.length < MAX_LOG) insertedLog.push(`${op.docketKey} (${op.partyName || "?"})`);
        } else {
          updated++;
          if (updatedLog.length < MAX_LOG) updatedLog.push(`${op.docketKey} (${op.partyName || "?"})`);
        }
      }

      const progress = Math.min(i + BATCH_SIZE, validRecords.length);
      process.stdout.write(`\r[SmartsheetSync] Processing ${progress}/${validRecords.length}`);
    }

    console.log("");
    if (insertedLog.length > 0) console.log(`[SmartsheetSync]  INSERTED (${inserted}): ${insertedLog.join(", ")}${inserted > MAX_LOG ? ` +${inserted - MAX_LOG} more` : ""}`);
    if (updatedLog.length > 0) console.log(`[SmartsheetSync]  UPDATED  (${updated}): ${updatedLog.join(", ")}${updated > MAX_LOG ? ` +${updated - MAX_LOG} more` : ""}`);
    if (inserted === 0 && updated === 0) console.log(`[SmartsheetSync]  No changes (all ${validRecords.length} records matched existing)`);

    const skipped = validRecords.length - inserted - updated;
    return { success: true, inserted, updated, skipped };
  }

  /**
   * Retrieves all Smartsheet tenders from PostgreSQL.
   */
  static async getAllSmartsheetTenders() {
    if (!prisma) {
      console.warn("[DatabaseSmartsheetService] Prisma client unavailable; returning empty list.");
      return [];
    }

    try {
      return await prisma.smartsheetTender.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });
    } catch (err) {
      console.error("[DatabaseSmartsheetService] Failed to query Smartsheet tenders:", err);
      return [];
    }
  }

  /**
   * Updates costing fields for a single tender by docketNumber (update-only).
   * Returns { success, found } — found=false when the docket row does not exist.
   */
  static async updateTenderCostingFields(docketNumber, fields) {
    if (!prisma) {
      return { success: false, found: false, error: "Prisma client unavailable" };
    }
    try {
      await prisma.smartsheetTender.update({
        where: { docketNumber },
        data: { ...fields, lastSyncedAt: new Date() },
      });
      return { success: true, found: true };
    } catch (err) {
      // P2025 = record not found
      if (err && err.code === "P2025") {
        return { success: false, found: false, error: "Record not found" };
      }
      return { success: false, found: false, error: err.message };
    }
  }

  /**
   * Scans the costing network folder (recursively) for each docket that does
   * not yet have an attachment URL, and stores the found file as an encrypted
   * "ENC1." value wrapping "network|<relative-path>". Plain URLs are untouched.
   */
  static async scanAndUpdateCostingFiles(limit = 100) {
    if (!prisma) {
      return { success: false, reason: "Prisma client unavailable" };
    }

    try {
      const records = await prisma.smartsheetTender.findMany({
        where: {
          attachmentUrl: null,
        },
      });

      const total = records.length;

      
      const candidates = records.filter((r) => {
        const url = (r.attachmentUrl || "").trim();
        return !url || url === "-";
      });

      const scannedTotal = candidates.length;
      const batch = candidates.slice(0, limit);

      const scanned = batch.length;
      let matched = 0;
      const updates = [];

      for (const record of batch) {
        const docketNumber = (record.docketNumber || "").trim();
        const numeric = extractNumericDocket(docketNumber);
        if (!numeric) continue;

        const relativePath = findCostingFileRecursive(docketNumber);
        if (!relativePath) continue;

        updates.push({
          id: record.id,
          docketNumber,
          attachmentUrl: encryptStoredPath(buildStoredPath(relativePath)),
        });
        matched++;
      }

      const BATCH_SIZE = 100;
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batchUpdates = updates.slice(i, i + BATCH_SIZE);
        const ops = batchUpdates.map((u) =>
          prisma.smartsheetTender.update({
            where: { id: u.id },
            data: { attachmentUrl: u.attachmentUrl, lastSyncedAt: new Date() },
          })
        );
        await prisma.$transaction(ops, { maxWait: 5000, timeout: 30000 });
      }

      console.log(`[DatabaseSmartsheetService] Costing file scan complete: ${matched}/${scanned} dockets matched (${scannedTotal - scanned} remaining).`);
      return {
        success: true,
        scanned,
        matched,
        notFound: scanned - matched,
        total,
        remaining: Math.max(0, scannedTotal - scanned),
      };
    } catch (err) {
      console.error("[DatabaseSmartsheetService] Costing file scan failed:", err);
      return { success: false, error: err.message };
    }
  }
}
