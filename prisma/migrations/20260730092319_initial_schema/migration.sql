-- CreateTable
CREATE TABLE "SmartsheetTender" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "enquiryDate" TEXT,
    "partyName" TEXT,
    "docketNumber" TEXT,
    "utility" TEXT,
    "quotationNumber" TEXT,
    "quotationDate" TEXT,
    "accountHolder" TEXT,
    "allocatedTo" TEXT,
    "status" TEXT,
    "reverseAuctionApplicable" TEXT,
    "cvaValue" TEXT,
    "tenderPurchase" TEXT,
    "attachmentUrl" TEXT,
    "proposedErpItemName" TEXT,
    "proposedQty" TEXT,
    "priceBasis" TEXT,
    "aluminiumPrice" DOUBLE PRECISION,
    "aluminiumAlloyPrice" DOUBLE PRECISION,
    "copperTapePrice" DOUBLE PRECISION,
    "extrudedSemiconductivePrice" DOUBLE PRECISION,
    "htXlpePrice" DOUBLE PRECISION,
    "pvcTypeSt2Price" DOUBLE PRECISION,
    "galvanisedSteelFlatStripPrice" DOUBLE PRECISION,
    "fillerPrice" DOUBLE PRECISION,
    "contractNo" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmartsheetTender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesContract" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "contractNumber" TEXT,
    "contractDate" TEXT,
    "customerName" TEXT,
    "partyOrderNo" TEXT,
    "partyOrderDate" TEXT,
    "itemCode" TEXT,
    "itemName" TEXT,
    "priceBasis" TEXT,
    "deliveryDate" TEXT,
    "contractQty" TEXT,
    "netContractQty" TEXT,
    "rate" TEXT,
    "mfgClrnQty" TEXT,
    "balanceContractQty" TEXT,
    "pendingOfferAgainstMC" TEXT,
    "pendingDIAgainstInspection" TEXT,
    "pendingDIAgainstContract" TEXT,
    "balanceDispatchQty" TEXT,
    "cancelledQty" TEXT,
    "invoiceQty" TEXT,
    "percentBalContractQty" TEXT,
    "itemScheduleName" TEXT,
    "ourStaffName" TEXT,
    "accountClass" TEXT,
    "basicValue" TEXT,

    CONSTRAINT "SalesContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmartsheetTender_docketNumber_key" ON "SmartsheetTender"("docketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SalesContract_quotationNumber_key" ON "SalesContract"("quotationNumber");
