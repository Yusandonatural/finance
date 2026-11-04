-- 添付の種類。'closing' は過去の決算書（年度ごと）。NULL は施策・年度共通の添付
ALTER TABLE attachments ADD COLUMN category TEXT;
