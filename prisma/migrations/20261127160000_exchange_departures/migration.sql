CREATE TABLE "RoomDeparture" (
  "id" SERIAL PRIMARY KEY,
  "roomId" UUID NOT NULL REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recordSlot" INTEGER,
  "snapshot" JSONB NOT NULL
);
CREATE INDEX "RoomDeparture_roomId_idx" ON "RoomDeparture"("roomId");
