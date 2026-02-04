CREATE INDEX "messages_fts_idx" ON "messages" USING gin (to_tsvector('english', "content")) WHERE ("role" = 'user' OR ("role" = 'assistant' AND "tool_name" IS NULL AND "tool_call_id" IS NULL));

