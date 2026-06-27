// backend/db.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Faltan SUPABASE_URL o SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function testConnection() {
  try {
    const { error } = await supabase.from('patients').select('id').limit(1);

    if (error) throw error;
    console.log('✅ Conexión a Supabase exitosa');
    return true;
  } catch (err) {
    console.error('❌ Error conectando a Supabase:', err.message);
    return false;
  }
}

module.exports = { supabase, testConnection };