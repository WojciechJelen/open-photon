-- The studio home's result wall and the wizard's free sample take (`listPrerenderedTakes`,
-- `findSampleTakeId` in src/features/motionTransfer/server/shot.ts) read the done pre-rendered takes
-- on every home and wizard load: a handful of rows, however many generations there are. Both
-- equality columns lead, so the planner prefers it to `generations_status_created`.
CREATE INDEX generations_prerendered ON generations (is_prerendered, status, finished_at)
WHERE is_prerendered = 1;
