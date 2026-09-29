-- =============================================================================
-- 0011_auth.sql
--
-- The three single-purpose token tables behind authentication. In every one,
-- only the SHA-256 of a token is stored (`token_hash`); the raw token exists
-- only in the email link or the httpOnly cookie that carries it. A leaked
-- copy of this database therefore cannot be replayed as a session, a
-- verification, or a password reset.
--
-- Tokens are 32 random bytes (256 bits), so an unsalted SHA-256 is sufficient:
-- there is nothing to brute-force, unlike a human-chosen password.
--
-- All timestamps are UTC DATETIMEs written by the application (a JS Date sent
-- through the pool's timezone:'Z'), and expiry is compared in the service
-- layer against the application clock. Nothing here relies on NOW() or on the
-- MySQL session's time zone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- email_verification — proves control of the address given at registration.
-- Single use (`used_at`) and expiring (`expires_at`, 24h).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification (
  token_hash CHAR(64)     NOT NULL COMMENT 'sha256 hex of the emailed token; the raw token is never stored.',
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_email_verification_user (user_id),
  CONSTRAINT fk_email_verification_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Email verification tokens (hash only). Single-use, 24h expiry.';

-- -----------------------------------------------------------------------------
-- refresh_token — one row per issued refresh token.
--
-- Rotation: every refresh revokes the presented row and inserts a new one.
-- Reuse detection: presenting an already-revoked token means either a stolen
-- copy is being replayed or the legitimate client raced itself; in both cases
-- the safe response is to revoke EVERY live token for that user, forcing a
-- fresh sign-in. Serves: WHERE user_id = ? AND revoked_at IS NULL.
--
-- There is no separate "family id" column: this product has no per-device
-- session management, so "the family" is simply all of a user's tokens.
-- user_agent is stored for a future "active sessions" screen and for
-- investigating a suspected theft; it is never used for a security decision.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_token (
  token_hash CHAR(64)     NOT NULL COMMENT 'sha256 hex of the cookie value; the raw token is never stored.',
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME     NOT NULL,
  revoked_at DATETIME     NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_refresh_token_user_revoked (user_id, revoked_at),
  CONSTRAINT fk_refresh_token_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Refresh tokens (hash only). Rotated on use; reuse revokes all of a user''s tokens.';

-- -----------------------------------------------------------------------------
-- password_reset — same pattern as email_verification, 1 hour expiry.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset (
  token_hash CHAR(64)     NOT NULL COMMENT 'sha256 hex of the emailed token; the raw token is never stored.',
  user_id    INT UNSIGNED NOT NULL,
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_password_reset_user (user_id),
  CONSTRAINT fk_password_reset_user
    FOREIGN KEY (user_id) REFERENCES `user` (user_id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Password reset tokens (hash only). Single-use, 1h expiry.';
