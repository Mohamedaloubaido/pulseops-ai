ALTER TABLE "Organization"
ADD COLUMN "statusPageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "statusPageTitle" TEXT,
ADD COLUMN "statusPageDescription" TEXT;
