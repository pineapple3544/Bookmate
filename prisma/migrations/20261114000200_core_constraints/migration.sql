ALTER TABLE "Room" ADD CONSTRAINT "Room_capacity_check" CHECK ("maxMembers" BETWEEN 2 AND 12);
ALTER TABLE "Room" ADD CONSTRAINT "Room_version_check" CHECK ("version" >= 0 AND "hostEpoch" >= 0);
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_order_check" CHECK ("readingOrder" > 0);
ALTER TABLE "RoomInvite" ADD CONSTRAINT "RoomInvite_usage_check" CHECK ("maxUses" BETWEEN 1 AND 12 AND "uses" BETWEEN 0 AND "maxUses");
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_text_check" CHECK (char_length("text") BETWEEN 1 AND 500 AND length(btrim("text")) > 0);
ALTER TABLE "BookTransfer" ADD CONSTRAINT "BookTransfer_check" CHECK ("fromUserId" <> "toUserId" AND "version" > 0);
