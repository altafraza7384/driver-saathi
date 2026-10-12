# Keep Assistant and Finance AI chat history for 1 day

## What changes for the user
- Chats with the Assistant and Finance AI stay visible after switching pages, closing the app or reopening it, on any device where the user is signed in.
- Each chat is kept for 24 hours. After that, older messages are removed automatically.
- The trash button still clears that chat right away, if the user wants to.
- The AI usage limit stays the same (it is counted on the server per hour). It does not reset when the user changes pages. Keeping the chat history does not change the limit either.

## Technical details
- Database: add a `chat_type` column ('assistant' | 'finance', default 'assistant') to the existing `chat_messages` table, plus an index on (user_id, chat_type, created_at). The existing per-user RLS policies (select/insert/delete only your own rows) stay as they are.
- Cleanup: an hourly pg_cron job runs `DELETE FROM chat_messages WHERE created_at < now() - interval '24 hours'`. Account deletion already removes these rows.
- Frontend (`AssistantPage.tsx`, `FinanceAIPage.tsx`):
  - On load, fetch the last 24h of messages for the user and that chat_type, oldest first.
  - Save the user message as soon as it is sent, and the assistant reply once streaming finishes.
  - Trash button deletes that user's rows for that chat_type.
  - Send only the most recent 20 messages to the AI, so the existing server limits are respected.
- Edge functions: no changes. History is stored by the client under RLS.
- Verify: build passes, then send messages, switch pages and reload to confirm the history is still there.
