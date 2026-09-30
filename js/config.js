// The only file that changes between the demo and the live site.
window.KLSSF_CONFIG = {
  // 'demo'     = no backend. Claims are kept in this browser only (localStorage).
  // 'supabase' = live. Calls the three database functions in backend/schema.sql.
  mode: 'demo',

  // Live mode only. Both values are public by design: the database rules,
  // not this key, are what protect the data.
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
