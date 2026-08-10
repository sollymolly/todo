/**
 * Whoever runs this instance. Used for the auto-friendship on sign-up and to
 * gate the feedback inbox.
 *
 * Its own module because "use server" files may only export async functions, so
 * a shared constant can't live in one.
 */
export const OWNER_EMAIL = (
  process.env.OWNER_EMAIL ?? "solpark0624@gmail.com"
)
  .trim()
  .toLowerCase();
