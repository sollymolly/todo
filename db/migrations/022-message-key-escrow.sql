-- ===========================================================================
--  Migration 022 — messages belong to the account, not the password
--
--  Run once in the Neon SQL Editor. Safe to re-run. Needs 021.
--
--  WHAT CHANGES
--  ------------
--  Until now the private key that reads your messages existed in exactly one
--  stored form: sealed under your password. Forget the password and the key
--  was gone, and with it every message (see 021). That was end-to-end
--  encryption doing precisely its job — and a poor fit for an app where
--  losing your history to a forgotten password is the bigger risk.
--
--  So the key is now also kept in escrow: sealed with AES-256-GCM under
--  MESSAGE_KEY_SECRET, a server-side secret that lives in the environment,
--  never in the database. That gives two ways to the same key:
--
--    * your password, exactly as before, and
--    * your account — any signed-in session can ask the server for it, and a
--      password reset hands it back to be re-sealed under the new password.
--
--  THE TRADE-OFF, PLAINLY
--  ----------------------
--  Whoever holds both the database and MESSAGE_KEY_SECRET can read messages.
--  That is the operator of this app. A copy of the database alone still
--  yields nothing, which is why the secret lives somewhere else. The privacy
--  policy (version 2) says so.
--
--  WHO IS COVERED
--  --------------
--  The server never had the key before, so it can only escrow a key when a
--  browser that has it unlocked sends it in: on sign-in, sign-up, a password
--  change, or opening Messages in a tab that is already unlocked. An account
--  that does none of those before forgetting its password is reset the old
--  way — fresh keys, history cleared.
-- ===========================================================================

alter table users add column if not exists escrowed_private_key text;

-- ---------------------------------------------------------------------------
-- reset_password, v2 — keeps the keypair (and the messages) when it can.
--
-- The browser brings back the escrowed key re-sealed under the new password,
-- with the same public key; then nothing about messages changes. Only when it
-- had to make a new keypair — no escrow, or no secret configured — are the
-- messages under the old one deleted, as in 021.
--
-- The four-argument version is dropped rather than left beside this one: two
-- overloads with a shared name is a trap for whoever calls it next.
-- ---------------------------------------------------------------------------
drop function if exists reset_password(text, text, text, text);

create or replace function reset_password(
  p_token_hash  text,
  p_hash        text,
  p_public_key  text,
  p_wrapped     text,
  p_escrow      text
)
returns uuid
language plpgsql
as $$
declare
  v_user     uuid;
  v_old_key  text;
begin
  update password_resets
     set used_at = now()
   where token_hash = p_token_hash
     and used_at is null
     and expires_at > now()
  returning user_id into v_user;

  if v_user is null then return null; end if;

  select public_key into v_old_key from users where id = v_user for update;

  update users set
    password_hash        = p_hash,
    auth_version         = 2,
    public_key           = p_public_key,
    wrapped_private_key  = p_wrapped,
    -- A new escrow if one came with the reset; otherwise keep the old one only
    -- while it still belongs to this keypair.
    escrowed_private_key = case
                             when p_escrow is not null then p_escrow
                             when v_old_key is not distinct from p_public_key
                               then escrowed_private_key
                             else null
                           end
  where id = v_user;

  -- Any other link still in someone's inbox dies with this one.
  update password_resets
     set used_at = now()
   where user_id = v_user and used_at is null;

  -- Only a new keypair orphans the old messages; the same keypair reads them.
  if v_old_key is distinct from p_public_key then
    delete from messages where sender_id = v_user or recipient_id = v_user;
  end if;

  return v_user;
end;
$$;
