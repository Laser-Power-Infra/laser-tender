/*
  Warnings:

  - A unique constraint covering the columns `[quotationNumber,itemCode]` on the table `SalesContract` will be added. If there are existing duplicate values, this will fail.
  - Made the column `itemCode` on table `SalesContract` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "SalesContract_quotationNumber_key";

-- AlterTable
ALTER TABLE "SalesContract" ALTER COLUMN "itemCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SalesContract_quotationNumber_itemCode_key" ON "SalesContract"("quotationNumber", "itemCode");
