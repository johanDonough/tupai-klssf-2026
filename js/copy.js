// Every visitor-facing string, English and Bahasa Malaysia, in one place.
window.COPY = {
  landing: {
    headline:  { en: 'Free Tupai for a full year.', bm: 'Tupai percuma selama setahun.' },
    subline:   { en: 'Family Duo plan. Claim yours here, this weekend only.', bm: 'Pelan Family Duo. Tuntut di sini, hujung minggu ini sahaja.' },
    left:      { en: 'accounts left', bm: 'akaun lagi' },
    scan:      { en: 'Scan to claim', bm: 'Imbas untuk tuntut' },
    register:  { en: 'Register here', bm: 'Daftar di sini' },
    footer:    'KL Seni & STEM Festival 2026 · 2–4 Oct · KLCC Park Esplanade'
  },
  form: {
    title:     { en: 'Claim your free year', bm: 'Tuntut setahun percuma' },
    name:      { en: 'Parent or guardian name', bm: 'Nama ibu bapa atau penjaga' },
    email:     { en: 'Email', bm: 'E-mel' },
    phone:     { en: 'Phone number', bm: 'Nombor telefon' },
    syllabus:  { en: 'Syllabus', bm: 'Silibus' },
    left:      { en: 'left', bm: 'lagi' },
    soldOut:   { en: 'All claimed', bm: 'Sudah habis' },
    consent:   { en: "I'm the parent or guardian, and I agree that Tupai may contact me about this account.", bm: 'Saya ibu bapa atau penjaga, dan saya bersetuju Tupai menghubungi saya tentang akaun ini.' },
    privacy:   { en: 'Privacy notice', bm: 'Notis privasi' },
    submit:    { en: 'Claim my account', bm: 'Tuntut akaun saya' },
    submitting:{ en: 'Claiming…', bm: 'Sedang menuntut…' },
    country:   'Country code'
  },
  errors: {
    name:      { en: 'Please enter a name.', bm: 'Sila masukkan nama.' },
    email:     { en: 'This email looks incomplete. Check it has an @ and a domain.', bm: 'E-mel ini belum lengkap. Pastikan ada @ dan domain.' },
    phoneMy:   { en: 'Enter 9 or 10 digits after +60.', bm: 'Masukkan 9 atau 10 digit selepas +60.' },
    phone:     { en: 'Enter a valid phone number.', bm: 'Masukkan nombor telefon yang sah.' },
    syllabus:  { en: 'Choose KSSM or IGCSE.', bm: 'Pilih KSSM atau IGCSE.' },
    consent:   { en: 'Tick this box to continue.', bm: 'Tandakan kotak ini untuk teruskan.' },
    full:      { en: '{syl} accounts are all claimed.', bm: 'Akaun {syl} sudah habis.' },
    generic:   { en: "Something didn't go through. Please check your details and try again.", bm: 'Ada yang tidak berjaya. Sila semak maklumat anda dan cuba lagi.' }
  },
  success: {
    title:     { en: 'Claim received.', bm: 'Tuntutan diterima.' },
    body:      { en: 'Our team will email you to activate your Family Duo account.', bm: 'Pasukan kami akan menghantar e-mel untuk mengaktifkan akaun anda.' },
    next:      { en: 'Next visitor', bm: 'Pelawat seterusnya' },
    returning: 'Returning to start in {n}s'
  },
  blocked: {
    already:   { en: 'This email or phone number has already claimed an account.', bm: 'E-mel atau nombor telefon ini sudah digunakan untuk tuntutan.' },
    before:    { en: 'Registration opens Friday 2 October, 8am.', bm: 'Pendaftaran dibuka Jumaat 2 Oktober, 8 pagi.' },
    closed:    { en: 'Registration has closed. Thank you for visiting us.', bm: 'Pendaftaran telah ditutup. Terima kasih kerana melawat kami.' },
    all:       { en: 'All 200 accounts have been claimed. Thank you!', bm: 'Kesemua 200 akaun telah dituntut. Terima kasih!' }
  },
  privacy: {
    title:     { en: 'Privacy notice', bm: 'Notis privasi' },
    en: 'Tupai (AI Teacher Sdn Bhd) collects your name, email and phone number to set up and activate your free Family Duo account, and to contact you about it. We do not sell your details. To see, correct or delete your details, email johan@tupai.ai.',
    bm: 'Tupai (AI Teacher Sdn Bhd) mengumpul nama, e-mel dan nombor telefon anda untuk menyediakan dan mengaktifkan akaun Family Duo percuma anda, serta menghubungi anda mengenainya. Kami tidak menjual maklumat anda. Untuk melihat, membetulkan atau memadam maklumat anda, e-mel johan@tupai.ai.',
    close:     'Close'
  },
  // Staff screens are English only.
  admin: {
    access:    'Staff access',
    passcode:  'Passcode',
    enter:     'Enter',
    checking:  'Checking…',
    wrong:     'Wrong passcode. {n} {tries} left.',
    locked:    'Too many tries. Try again in {m} {minutes}.',
    failed:    "Couldn't reach the server. Try again.",
    logout:    'Log out',
    refresh:   'Refresh',
    search:    'Search name, email or phone',
    total:     'TOTAL',
    exportK:   'Export KSSM CSV',
    exportI:   'Export IGCSE CSV',
    exportAll: 'Export all CSV',
    cols:      ['#', 'NAME', 'EMAIL', 'PHONE', 'REGISTERED (MYT)'],
    noMatch:   'No claims match “{q}”.',
    empty:     "No {tab} claims yet. They'll appear here as visitors register.",
    downloaded:'{what} downloaded',
    refreshed: 'List refreshed'
  }
};
