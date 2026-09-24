-- =============================================================================
-- 0005_init_social.sql
--
-- What happens after a match: chat, teammate ratings, moderation reports, and
-- the trigger-populated audit trail.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- message — group chat. BIGINT because this is the one table with a genuinely
-- unbounded growth rate; an INT would be a 4-billion-row time bomb, and
-- widening a primary key later is an expensive table rebuild.
--
-- created_at is DATETIME(3): message ordering needs sub-second precision, and
-- two messages posted in the same second must still have a deterministic
-- order for keyset pagination. The (created_at, message_id) tuple is what
-- makes backwards paging stable.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message (
  message_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id   INT UNSIGNED    NOT NULL,
  user_id    INT UNSIGNED    NOT NULL,
  body       VARCHAR(2000)   NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at  DATETIME(3)     NULL,
  -- Soft delete: the API returns a tombstone rather than omitting the row, so
  -- client-side ordering never develops holes and a moderator action stays
  -- auditable.
  deleted_at DATETIME(3)     NULL,
  PRIMARY KEY (message_id),
  -- Serves the backwards keyset page fetch:
  --   WHERE group_id = ? AND (created_at, message_id) < (?, ?) ORDER BY ... DESC
  KEY idx_message_group_time (group_id, created_at, message_id),
  KEY idx_message_user (user_id),
  CONSTRAINT fk_message_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- CASCADE: deleting an account removes that person's messages. The
  -- alternative (SET NULL, leaving orphan text) would keep content a user
  -- asked to have removed.
  CONSTRAINT fk_message_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- Whitespace-only messages are rejected at the API, but an empty body at the
  -- storage layer would also break the "last message preview" on the dashboard.
  CONSTRAINT ck_message_body_not_empty CHECK (CHAR_LENGTH(TRIM(body)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Group chat. Persisted first; the socket only broadcasts.';

-- -----------------------------------------------------------------------------
-- rating — a post-session teammate rating.
--
-- The composite primary key (rater, ratee, session) is the business rule
-- expressed structurally: one rating per pair per session. No application
-- check is needed, and no race can produce a duplicate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rating (
  rater_user_id INT UNSIGNED     NOT NULL,
  ratee_user_id INT UNSIGNED     NOT NULL,
  session_id    INT UNSIGNED     NOT NULL,
  score         TINYINT UNSIGNED NOT NULL,
  note          VARCHAR(300)     NULL,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rater_user_id, ratee_user_id, session_id),
  -- Serves "this user's average rating" on the public profile.
  KEY idx_rating_ratee (ratee_user_id),
  KEY idx_rating_session (session_id),
  CONSTRAINT fk_rating_rater
    FOREIGN KEY (rater_user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rating_ratee
    FOREIGN KEY (ratee_user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rating_session
    FOREIGN KEY (session_id) REFERENCES play_session (session_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_rating_score CHECK (score BETWEEN 1 AND 5),
  -- Self-rating would be free reputation. Eligibility beyond this (both users
  -- actually attended) needs a query across group_member and is enforced by
  -- trg_rating_bi in 0009 — a CHECK cannot read other tables.
  CONSTRAINT ck_rating_not_self CHECK (rater_user_id <> ratee_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Post-session teammate ratings, one per (rater, ratee, session).';

-- -----------------------------------------------------------------------------
-- report — moderation. A group finder's real threat model is harassment, so
-- this is a first-class entity rather than an afterthought.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report (
  report_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_user_id INT UNSIGNED NOT NULL,
  reported_user_id INT UNSIGNED NOT NULL,
  group_id         INT UNSIGNED NULL COMMENT 'Context, when the report is about conduct in a group.',
  reason ENUM('harassment','hate_speech','cheating','spam','impersonation','other')
         NOT NULL,
  detail           VARCHAR(1000) NULL,
  state ENUM('open','reviewing','actioned','dismissed') NOT NULL DEFAULT 'open',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id),
  -- Serves the admin queue: open reports, oldest first.
  KEY idx_report_state_created (state, created_at),
  KEY idx_report_reported (reported_user_id),
  KEY idx_report_reporter (reporter_user_id),
  KEY idx_report_group (group_id),
  CONSTRAINT fk_report_reporter
    FOREIGN KEY (reporter_user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_report_reported
    FOREIGN KEY (reported_user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  -- SET NULL: the group may be archived and cleaned up, but the report about a
  -- person's conduct must outlive its context.
  CONSTRAINT fk_report_group
    FOREIGN KEY (group_id) REFERENCES lfg_group (group_id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT ck_report_not_self CHECK (reporter_user_id <> reported_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='User reports for moderation. Worked from the /admin queue.';

-- -----------------------------------------------------------------------------
-- audit_log — written exclusively by triggers (0009) when a sensitive column
-- changes: account status, display name.
--
-- Deliberately generic (table_name + row_pk + JSON before/after) rather than a
-- typed column per audited field. A typed design would need a migration every
-- time a new column becomes sensitive; this one needs a trigger. The JSON is
-- provenance — nothing branches on its contents (zyBooks Ch. 8).
--
-- actor_user_id is NULLable because a trigger cannot always know who acted: a
-- change made by the ETL or a migration has no user behind it, and claiming one
-- would be worse than recording NULL.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  table_name    VARCHAR(64)     NOT NULL,
  row_pk        VARCHAR(64)     NOT NULL,
  action        ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  actor_user_id INT UNSIGNED    NULL,
  changed_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  old_values    JSON            NULL,
  new_values    JSON            NULL,
  PRIMARY KEY (audit_id),
  -- Serves "what happened to this row", the question an audit log exists for.
  KEY idx_audit_log_table_row (table_name, row_pk, changed_at),
  KEY idx_audit_log_actor (actor_user_id),
  -- SET NULL, never CASCADE: deleting an account must not erase the audit
  -- trail of what that account did. That is the entire point of an audit log.
  CONSTRAINT fk_audit_log_actor
    FOREIGN KEY (actor_user_id) REFERENCES `user` (user_id)
    ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Trigger-populated record of sensitive changes. Never written by app code.';
