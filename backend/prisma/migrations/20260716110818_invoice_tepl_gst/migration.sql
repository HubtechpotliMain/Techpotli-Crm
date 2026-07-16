-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "hsnSac" TEXT NOT NULL DEFAULT '998314',
ADD COLUMN IF NOT EXISTS "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "placeOfSupply" TEXT,
ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "shipTo" JSONB,
ADD COLUMN IF NOT EXISTS "taxType" TEXT NOT NULL DEFAULT 'IGST';

-- Seed TEPL FY 26-27 sequence so next invoice is 113
INSERT INTO "NumberSequence" ("id", "prefix", "year", "lastNumber")
VALUES (gen_random_uuid()::text, 'TEPL', 2026, 112)
ON CONFLICT ("prefix", "year") DO UPDATE
SET "lastNumber" = GREATEST("NumberSequence"."lastNumber", 112);
