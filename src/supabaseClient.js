
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase Config Check:');
console.log('URL:', supabaseUrl ? supabaseUrl : 'MISSING');
console.log('Key:', supabaseAnonKey ? (supabaseAnonKey.substring(0, 5) + '...') : 'MISSING');

let client;

try {
    if (!supabaseUrl || !supabaseUrl.startsWith('http')) {
        throw new Error('Invalid Supabase URL. It must start with http:// or https://');
    }
    if (!supabaseAnonKey) {
        throw new Error('Missing Supabase Anon Key');
    }
    client = createClient(supabaseUrl, supabaseAnonKey);
} catch (error) {
    console.error('FAILED TO INITIALIZE SUPABASE:', error.message);
    // Fallback mock client to prevent app crash
    client = {
        from: () => ({
            select: () => ({ ilike: () => ({ data: [], error: 'Supabase not configured: ' + error.message }) }),
            insert: () => Promise.resolve({ error: 'Supabase not configured: ' + error.message })
        })
    };
}

export const supabase = client;
