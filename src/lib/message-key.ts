import { escrowMyKey, recoverMyKey } from "@/lib/social-actions";
import {
  exportPrivateKey,
  importPrivateKey,
  loadPrivateKey,
  rememberPrivateKey,
} from "@/lib/crypto";

/* --------------------------------------------------------------------------
   The one place the app gets the key that reads messages.

   This tab's copy if it has one; otherwise the account's copy from escrow
   (migration 022). That second step is what makes messages belong to the
   account: a new device, or a sign-in that never typed a password here, still
   opens every thread.
   -------------------------------------------------------------------------- */

export async function getMessageKey(): Promise<CryptoKey | null> {
  const local = await loadPrivateKey();
  if (local) return local;

  try {
    const pkcs8 = await recoverMyKey();
    if (!pkcs8) return null;
    const key = await importPrivateKey(pkcs8);
    await rememberPrivateKey(key);
    return key;
  } catch {
    return null;
  }
}

/**
 * Hands an unlocked key to the server for escrow. Harmless to repeat — the
 * server keeps the first matching copy — and never fatal: an account without
 * escrow simply keeps working the old way.
 */
export async function escrowKey(key: CryptoKey): Promise<void> {
  try {
    await escrowMyKey(await exportPrivateKey(key));
  } catch {
    /* escrow is a safety net, not a requirement */
  }
}
