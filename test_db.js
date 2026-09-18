require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('Fetching latest 3 messages...');
  const { data: msgs, error: msgsErr } = await supabase
    .from('messages')
    .select('id, created_at, content_text, account_id, sender_type')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (msgsErr) console.error('Error msgs:', msgsErr);
  console.log(msgs);

  console.log('\nFetching latest 3 contacts...');
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, created_at, name, psid, account_id')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log(contacts);
  
  console.log('\nFetching messenger configs...');
  const { data: configs } = await supabase
    .from('whatsapp_config')
    .select('id, phone_number_id, waba_id, account_id')
    .limit(3);
  console.log(configs);
})();
