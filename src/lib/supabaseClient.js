export const supabaseUrl = 'https://czxicysnfwvxapipzysg.supabase.co';
export const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6eGljeXNuZnd2eGFwaXB6eXNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNDY3MTYsImV4cCI6MjA4MDYyMjcxNn0.cgk7AxkRzkptv0lzj-63J2vBqj1dqB3OCk5qeq9BQqo';

export function createSupabaseClient() {
  if (!window.supabase) {
    console.error("Supabase CDN not loaded. Ensure the Supabase script tag exists in index.html");
    return null;
  }
  return window.supabase.createClient(supabaseUrl, supabaseKey);
}
