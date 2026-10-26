// Supabase settings for online (community) maps.
//
// The anon / publishable key is meant to be public: it ships in the
// page, and the row-level security in supabase/rhythm_schema.sql
// controls what it can do. Never put the service_role / secret key here.
//
// Leave anonKey empty to run the game without online maps.
window.RHYTHM_SUPABASE = {
    url: 'https://gzqwhhbxbctrbspyylom.supabase.co',
    anonKey: 'sb_publishable_nYAkiwkX63rRlMHdf7UPsw_B9vQlzGF',   // Supabase dashboard → Project Settings → API → anon public (or publishable) key
};
