/* Where the shared data lives.
 *
 * Fill these two in from your Supabase project (Settings → API):
 *   SUPABASE_URL       the Project URL, e.g. https://abcdefgh.supabase.co
 *   SUPABASE_ANON_KEY  the anon / public key
 *
 * The anon key is meant to be public — it's in every visitor's browser by
 * design. What actually protects the data is the row-level security in
 * schema.sql, which is why that file must be run before this one matters.
 * Never put the service_role key here; that one bypasses every rule.
 *
 * While these are blank the app runs in preview mode: everything saves to
 * the visitor's own device and nobody sees anyone else.
 */
window.CONFIG = {
  SUPABASE_URL: 'https://ukgygzvyzygummbeobmk.supabase.co',
  SUPABASE_ANON_KEY: ''
};
