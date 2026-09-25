-- Reverses 0007. Order does not matter for views (no FKs between them), but
-- listed newest-first to mirror the up-file for readability.
DROP VIEW IF EXISTS v_game_popularity;
DROP VIEW IF EXISTS v_member_count_reconciliation;
DROP VIEW IF EXISTS v_group_activity;
DROP VIEW IF EXISTS v_user_availability_minutes;
DROP VIEW IF EXISTS v_user_profile_full;
DROP VIEW IF EXISTS v_group_card;
