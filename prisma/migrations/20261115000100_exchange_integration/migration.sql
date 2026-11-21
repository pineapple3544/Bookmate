-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "author" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "exchangeCode" TEXT,
ADD COLUMN     "exchangeOwnerId" UUID,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'mint';

-- AlterTable
ALTER TABLE "RoomMember" ADD COLUMN     "appearance" JSONB,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "quote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rating" DOUBLE PRECISION,
ADD COLUMN     "review" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Room_exchangeCode_key" ON "Room"("exchangeCode");
