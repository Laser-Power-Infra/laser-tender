-- Performance certificates, copied as they are from the tender executive dashboard (database tender-executive-dashboard-production):
-- table performance_certificates and "_CertSupplyHistory", the link between a certificate and the supply history rows of its party order.
-- Same names, columns, types, keys and indexes as there, so sync/supply_history_sync.ts can copy rows across without mapping.
CREATE TABLE "performance_certificates" (
  "id" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "certificateName" text,
  "certificateUrl" text,
  "itemSchedule" text,
  "partyName" text,
  "useNotUse" text,
  "utilityOrClient" text,
  "issueDate" timestamp(3),
  "signingDate" timestamp(3),
  "utilityNames" text,
  "duplicateOfId" text,
  "serial" serial NOT NULL,
  "partyReferenceNo" text,
  CONSTRAINT "performance_certificates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_certificates_serial_key" ON "performance_certificates" ("serial");
CREATE INDEX "performance_certificates_duplicateOfId_idx" ON "performance_certificates" ("duplicateOfId");
ALTER TABLE "performance_certificates" ADD CONSTRAINT "performance_certificates_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "performance_certificates" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma's own link table for the many-to-many relation "CertSupplyHistory": A = performance_certificates.id, B = "SupplyHistory".id
CREATE TABLE "_CertSupplyHistory" (
  "A" text NOT NULL,
  "B" text NOT NULL,
  CONSTRAINT "_CertSupplyHistory_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_CertSupplyHistory_B_index" ON "_CertSupplyHistory" ("B");
ALTER TABLE "_CertSupplyHistory" ADD CONSTRAINT "_CertSupplyHistory_A_fkey"
  FOREIGN KEY ("A") REFERENCES "performance_certificates" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CertSupplyHistory" ADD CONSTRAINT "_CertSupplyHistory_B_fkey"
  FOREIGN KEY ("B") REFERENCES "SupplyHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
