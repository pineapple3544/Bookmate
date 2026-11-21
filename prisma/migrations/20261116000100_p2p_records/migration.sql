CREATE TABLE "RecordOperation" (
 "id" UUID NOT NULL PRIMARY KEY, "roomId" UUID NOT NULL, "authorId" UUID NOT NULL,
 "actorSlot" INTEGER NOT NULL, "sequence" BIGSERIAL NOT NULL UNIQUE,
 "kind" TEXT NOT NULL, "slot" INTEGER NOT NULL, "page" INTEGER NOT NULL,
 "postId" UUID, "replyId" UUID, "digest" TEXT NOT NULL, "bytes" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RecordOperation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RecordOperation_roomId_sequence_idx" ON "RecordOperation"("roomId", "sequence");
CREATE INDEX "RecordOperation_roomId_slot_page_idx" ON "RecordOperation"("roomId", "slot", "page");
