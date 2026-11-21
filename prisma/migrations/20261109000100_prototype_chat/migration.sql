CREATE TABLE "PrototypeChatMessage" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "senderSlot" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrototypeChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrototypeChatMessage_slot_check" CHECK ("senderSlot" BETWEEN 0 AND 3),
  CONSTRAINT "PrototypeChatMessage_text_check" CHECK (char_length(btrim("text")) BETWEEN 1 AND 500),
  CONSTRAINT "PrototypeChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrototypeChatMessage_sequence_key" ON "PrototypeChatMessage"("sequence");
CREATE INDEX "PrototypeChatMessage_roomId_sequence_idx" ON "PrototypeChatMessage"("roomId", "sequence");
-- Create the local prototype room once. Deleting it does not resurrect it on a server restart.
INSERT INTO "Room" ("id", "title", "bookTitle", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', '임시 문구1', '임시 문구1', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
