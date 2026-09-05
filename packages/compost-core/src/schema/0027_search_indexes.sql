-- Transactional derived search indexes. No external tokenizer or service.
-- Bigram phrase positions preserve adjacency; x marks every non-Han boundary.
CREATE TABLE search_index_state (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  source_revision INTEGER NOT NULL DEFAULT 0,
  indexed_revision INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rebuilt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE VIEW action_log_cjk_source AS
SELECT rowid, COALESCE((
  WITH RECURSIVE input(body) AS (SELECT coalesce(source_system, '') || ' ' || coalesce(source_id, '') || ' ' || coalesce(project, '') || ' ' || coalesce(what_text, '') || ' ' || coalesce(next_query_hint, '') || ' ' || coalesce((SELECT group_concat(atom,' ') FROM json_tree(action_log.artifact_locations) WHERE type='text'), '')),
  positions(pos, size) AS (
    SELECT 1, length(body) FROM input WHERE length(body) >= 2 AND body GLOB '*[㐀-鿿豈-﫿𠀀-𲎯]*'
    UNION ALL SELECT pos + 1, size FROM positions WHERE pos + 1 < size
  )
  SELECT group_concat(token, ' ') FROM (
    SELECT CASE WHEN (unicode(substr(body,pos,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos,1)) BETWEEN 131072 AND 205743) AND (unicode(substr(body,pos+1,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos+1,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos+1,1)) BETWEEN 131072 AND 205743)
      THEN lower(hex(substr(body,pos,2))) ELSE 'x' END AS token
    FROM positions, input WHERE (unicode(substr(body,pos,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos,1)) BETWEEN 131072 AND 205743) ORDER BY pos
  )
), '') AS grams FROM action_log;
CREATE VIRTUAL TABLE action_log_cjk USING fts5(grams);
INSERT INTO search_index_state(name,version) VALUES ('actions',1);
CREATE VIRTUAL TABLE actions_fts USING fts5(source_system, source_id, project, what_text, next_query_hint, artifact_locations, content='action_log', content_rowid='rowid');
CREATE TRIGGER action_log_search_ai AFTER INSERT ON action_log BEGIN
INSERT INTO actions_fts(rowid,source_system, source_id, project, what_text, next_query_hint, artifact_locations) VALUES (new.rowid,new.source_system, new.source_id, new.project, new.what_text, new.next_query_hint, new.artifact_locations);
INSERT INTO action_log_cjk(rowid,grams) SELECT rowid,grams FROM action_log_cjk_source WHERE rowid=new.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='actions';
END;
CREATE TRIGGER action_log_search_ad AFTER DELETE ON action_log BEGIN
INSERT INTO actions_fts(actions_fts,rowid,source_system, source_id, project, what_text, next_query_hint, artifact_locations) VALUES ('delete',old.rowid,old.source_system, old.source_id, old.project, old.what_text, old.next_query_hint, old.artifact_locations);
DELETE FROM action_log_cjk WHERE rowid=old.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='actions';
END;
CREATE TRIGGER action_log_search_au AFTER UPDATE OF source_system,source_id,project,what_text,next_query_hint,artifact_locations ON action_log BEGIN
INSERT INTO actions_fts(actions_fts,rowid,source_system, source_id, project, what_text, next_query_hint, artifact_locations) VALUES ('delete',old.rowid,old.source_system, old.source_id, old.project, old.what_text, old.next_query_hint, old.artifact_locations);
INSERT INTO actions_fts(rowid,source_system, source_id, project, what_text, next_query_hint, artifact_locations) VALUES (new.rowid,new.source_system, new.source_id, new.project, new.what_text, new.next_query_hint, new.artifact_locations);
DELETE FROM action_log_cjk WHERE rowid=old.rowid;
INSERT INTO action_log_cjk(rowid,grams) SELECT rowid,grams FROM action_log_cjk_source WHERE rowid=new.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='actions';
END;
INSERT INTO action_log_cjk(rowid,grams) SELECT rowid,grams FROM action_log_cjk_source;
INSERT INTO actions_fts(actions_fts) VALUES('rebuild');
CREATE VIEW facts_cjk_source AS
SELECT rowid, COALESCE((
  WITH RECURSIVE input(body) AS (SELECT coalesce(subject, '') || ' ' || coalesce(predicate, '') || ' ' || coalesce(object, '')),
  positions(pos, size) AS (
    SELECT 1, length(body) FROM input WHERE length(body) >= 2 AND body GLOB '*[㐀-鿿豈-﫿𠀀-𲎯]*'
    UNION ALL SELECT pos + 1, size FROM positions WHERE pos + 1 < size
  )
  SELECT group_concat(token, ' ') FROM (
    SELECT CASE WHEN (unicode(substr(body,pos,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos,1)) BETWEEN 131072 AND 205743) AND (unicode(substr(body,pos+1,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos+1,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos+1,1)) BETWEEN 131072 AND 205743)
      THEN lower(hex(substr(body,pos,2))) ELSE 'x' END AS token
    FROM positions, input WHERE (unicode(substr(body,pos,1)) BETWEEN 13312 AND 40959 OR unicode(substr(body,pos,1)) BETWEEN 63744 AND 64255 OR unicode(substr(body,pos,1)) BETWEEN 131072 AND 205743) ORDER BY pos
  )
), '') AS grams FROM facts;
CREATE VIRTUAL TABLE facts_cjk USING fts5(grams);
INSERT INTO search_index_state(name,version) VALUES ('facts',1);
CREATE TRIGGER facts_search_ai AFTER INSERT ON facts BEGIN

INSERT INTO facts_cjk(rowid,grams) SELECT rowid,grams FROM facts_cjk_source WHERE rowid=new.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='facts';
END;
CREATE TRIGGER facts_search_ad AFTER DELETE ON facts BEGIN

DELETE FROM facts_cjk WHERE rowid=old.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='facts';
END;
CREATE TRIGGER facts_search_au AFTER UPDATE OF subject,predicate,object ON facts BEGIN

DELETE FROM facts_cjk WHERE rowid=old.rowid;
INSERT INTO facts_cjk(rowid,grams) SELECT rowid,grams FROM facts_cjk_source WHERE rowid=new.rowid;
UPDATE search_index_state SET source_revision=source_revision+1,indexed_revision=indexed_revision+1,indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name='facts';
END;
INSERT INTO facts_cjk(rowid,grams) SELECT rowid,grams FROM facts_cjk_source;
CREATE INDEX idx_action_log_epoch ON action_log(julianday(when_ts) DESC, created_at DESC);
CREATE INDEX idx_action_log_project_epoch ON action_log(project,julianday(when_ts) DESC, created_at DESC);
CREATE INDEX idx_action_log_system_epoch ON action_log(source_system,julianday(when_ts) DESC, created_at DESC);
