
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://rwkpepnojxidizqxgisu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3a3BlcG5vanhpZGl6cXhnaXN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxOTE5MzMsImV4cCI6MjA2NTc2NzkzM30.wHfBn4_0krhBKGwUk-2OJjjBx-_VS2WyH7USgsr7MiM';

export const supabase = createClient(supabaseUrl, supabaseKey);
