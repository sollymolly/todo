-- ===========================================================================
--  Migration 021 — forgotten passwords
--
--  Run once in the Neon SQL Editor. Safe to re-run. Needs 002.
--
--  THE LINK
--  --------
--  A reset link carries a random 256-bit token. Only its SHA-256 is stored, so
--  a read of this table — a leaked backup, a stray SELECT — yields nothing
--  that can be pasted into a browser. Tokens last 30 minutes and are single
--  use, and asking for a new link kills any older one.
--
--  WHAT A RESET COSTS
--  ------------------
--  Messages are end-to-end encrypted under a keypair whose private half is
--  sealed with the *password*. Nobody holding a reset link knows the old
--  password — that is the whole premise — so the old private key cannot be
--  recovered, by the user or by this server. A reset therefore issues a fresh
--  keypair, and every message the account ever sent or received becomes
--  ciphertext that no key in existence opens: the friend on the other end
--  derives the conversation key from *this* account's current public key,
--  which has just changed.
--
--  Those rows are deleted in the same transaction rather than left to fail
--  decryption in both people's threads forever. Everything else — quests, XP,
--  gear, habits, friendships — is untouched.
-- ===========================================================================

create table if not exists password_resets (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists password_resets_user_idx on password_resets(user_id);

-- ---------------------------------------------------------------------------
-- reset_password — spends a token and replaces the credential, atomically.
--
-- Returns the account's id, or null when the token is unknown, spent or
-- expired. The token is claimed by the first UPDATE, so two submissions of
-- the same link race harmlessly: exactly one gets a row back.
-- ---------------------------------------------------------------------------
create or replace function reset_password(
  p_token_hash  text,
  p_hash        text,
  p_public_key  text,
  p_wrapped     text
)
returns uuid
language plpgsql
as $$
declare
  v_user uuid;
begin
  update password_resets
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning user_id into v_user;

  if v_user is null then return null; end if;

  -- auth_version 2 regardless of where it started: the browser derived this
  -- secret the modern way, so a legacy account is upgraded in passing.
  update users set
    password_hash       = p_hash,
    auth_version        = 2,
    public_key          = p_public_key,
    wrapped_private_key = p_wrapped
  where id = v_user;

  -- Any other link still in someone's inbox dies with this one.
  update password_resets
     set used_at = now()
   where user_id = v_user and used_at is null;

  -- Unreadable by anyone from here on — see the note at the top.
  delete from messages where sender_id = v_user or recipient_id = v_user;

  return v_user;
end;
$$;
