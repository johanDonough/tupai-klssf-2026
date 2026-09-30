// The only file that changes between the demo and the live site.
window.KLSSF_CONFIG = {
  // 'demo'     = no backend. Claims are kept in this browser only (localStorage).
  // 'sheets'   = live, Google Sheet. Calls the web app in backend-sheets/Code.gs.
  // 'supabase' = live, database. Calls the functions in backend/schema.sql.
  mode: 'demo',

  // 'sheets' mode: the web app URL from Apps Script (Deploy > Manage deployments).
  // It ends in /exec. It is public by design; the script decides what it will answer.
  sheetsUrl: '',

  // 'supabase' mode only. Both values are public by design.
  supabaseUrl: '',      // e.g. https://abcdefgh.supabase.co
  supabaseAnonKey: '',  // the project's anon / publishable key

  logo: 'assets/parent-app-logo.svg',   // shown top-left; also the hidden staff entry

  pollSeconds: 20,         // how often the counters refresh
  boothReturnSeconds: 10,  // success screen -> landing page on the booth device

  // Demo mode only.
  demo: {
    passcode: 'demo',
    kssmCap: 100,
    igcseCap: 100
  }
};
