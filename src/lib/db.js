export function createDB(sb, Utils) {
  /**
   * Helper to remove fields that don't exist in Supabase schema
   * This prevents PGRST204 errors when these fields are accidentally included
   * NOTE: history DOES exist in DB (jsonb), so we don't remove it
   */
  const removeExtrasFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = { ...obj };
    // Remove timeline and tagNumber (they don't exist in DB, stored in localStorage)
    // Keep history (it exists in DB as jsonb)
    delete clean.timeline;
    delete clean.tagNumber;
    return clean;
  };

  /**
   * Migrate legacy localStorage data to Supabase on first load
   * This ensures data consistency and allows cleanup of localStorage
   */
  const migrateLegacyData = async () => {
    try {
      const { data: tickets } = await sb.from('tickets').select('id');
      if (!tickets) return;

      const existingIds = new Set(tickets.map(t => t.id));
      
      // Find all localStorage keys with ticket extras
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ticket_extras_')) {
          const ticketId = key.replace('ticket_extras_', '');
          if (existingIds.has(ticketId)) {
            legacyKeys.push(key);
          }
        }
      }

      // Migrate each legacy entry
      for (const key of legacyKeys) {
        try {
          const ticketId = key.replace('ticket_extras_', '');
          const extras = JSON.parse(localStorage.getItem(key) || '{}');
          
          // Migration: extras are already in localStorage, no need to update Supabase
          // Just keep them in localStorage (they're not columns in Supabase)
          // This migration function can be simplified or removed
          if (extras.history || extras.timeline || extras.tagNumber !== undefined) {
            // Extras are already stored correctly in localStorage, no action needed
            console.log(`Keeping extras for ticket ${ticketId} in localStorage`);
          }
        } catch (e) {
          console.warn(`Failed to migrate legacy data for ${key}:`, e);
        }
      }
    } catch (e) {
      console.warn('Legacy data migration failed:', e);
    }
  };

  /**
   * Get the actual tickets table schema from Supabase
   * This helps verify which columns exist before making queries
   */
  const getTicketsSchema = async () => {
    try {
      // Query information_schema to get column details
      const { data, error } = await sb.rpc('exec_sql', {
        query: `
          SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tickets'
          ORDER BY ordinal_position;
        `
      }).catch(() => {
        // If RPC doesn't exist, try direct query (may require service role)
        return { data: null, error: { message: 'RPC not available, use SQL editor instead' } };
      });

      if (error) {
        console.warn('[Schema] Could not fetch via RPC, use SQL editor with:', `
          SELECT
            column_name,
            data_type,
            is_nullable,
            column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'tickets'
          ORDER BY ordinal_position;
        `);
        return null;
      }

      return data;
    } catch (e) {
      console.warn('[Schema] Schema fetch failed:', e);
      return null;
    }
  };

  return {
    // Expose schema getter for debugging
    getSchema: getTicketsSchema,
    
    getAll: async () => {
      if (!sb) return [];
      try {
        const { data, error } = await sb
          .from('tickets')
          .select('*')
          .order('createdAt', { ascending: false });

        if (error) {
          console.error("Supabase Error:", error.message || error, error.details || '');
          Utils.showToast("שגיאה בטעינת הנתונים", "error");
          return [];
        }

        // Ensure all tickets have default values for optional fields
        // Merge with localStorage extras (timeline, tagNumber)
        // history comes from DB, timeline/tagNumber from localStorage
        return (data || []).map(t => {
          const extras = JSON.parse(localStorage.getItem(`ticket_extras_${t.id}`) || '{}');
          return {
            ...t,
            history: t.history || [],
            timeline: extras.timeline || [],
            tagNumber: extras.tagNumber !== undefined ? extras.tagNumber : null,
            quote: t.quote || { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false }
          };
        });
      } catch (e) {
        console.error("DB Connection Error:", e.message || e, e.details || '');
        Utils.showToast("שגיאה בחיבור למסד הנתונים", "error");
        return [];
      }
    },

    add: async (ticket) => {
      try {
        // Extract fields that don't exist in Supabase schema (timeline, tagNumber)
        // NOTE: history DOES exist in DB (jsonb), so we keep it
        const { timeline, tagNumber, ...supabaseFields } = ticket;
        
        // Remove immutable fields
        const { id: _id, createdAt: _createdAt, ...mutableFields } = supabaseFields;
        
        // Clean any remaining extras that might have slipped through
        const cleanFields = removeExtrasFromObject(mutableFields);
        
        // Ensure jsonb fields are proper JSON objects
        if (cleanFields.history && typeof cleanFields.history === 'string') {
          try {
            cleanFields.history = JSON.parse(cleanFields.history);
          } catch (e) {
            console.warn('[DB.add] Failed to parse history as JSON:', e);
            cleanFields.history = [];
          }
        }
        if (cleanFields.quote && typeof cleanFields.quote === 'string') {
          try {
            cleanFields.quote = JSON.parse(cleanFields.quote);
          } catch (e) {
            console.warn('[DB.add] Failed to parse quote as JSON:', e);
          }
        }
        
        const newTicket = {
          id: Utils.id(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...cleanFields
        };

        const { data, error } = await sb.from('tickets').insert([newTicket]).select('id, createdAt, updatedAt, ticketNumber, customerName, customerPhone, customerEmail, bikeModel, issueDescription, status, priority, internalNotes, is_archived, history, quote').single();

        if (error) {
          console.error("Error saving ticket:", error.message || error, error.details || '');
          Utils.showToast("שגיאה בשמירה", "error");
          throw error;
        }

        // Store timeline and tagNumber in localStorage (they don't exist in DB)
        // history is stored in DB, so we get it from the response
        const extras = {
          timeline: timeline || [],
          tagNumber: tagNumber || null
        };
        localStorage.setItem(`ticket_extras_${data.id}`, JSON.stringify(extras));

        // Merge extras from localStorage with Supabase data
        return {
          ...data,
          timeline: extras.timeline,
          tagNumber: extras.tagNumber
        };
      } catch (e) {
        console.error("Failed to add ticket:", e.message || e, e.details || '');
        Utils.showToast("שגיאה בשמירת התיקון", "error");
        throw e;
      }
    },

    update: async (id, updates) => {
      try {
        // Guard: prevent automatic updates on page load
        if (typeof window !== 'undefined' && window.app && !window.app.allowRemoteWrites) {
          console.warn('[DB.update] Blocked: allowRemoteWrites is false. Update was triggered automatically.');
          console.warn('[DB.update] Call stack:', new Error().stack);
          throw new Error('Update blocked: not from explicit user action');
        }

        // Extract fields that don't exist in Supabase schema (timeline, tagNumber)
        // NOTE: history DOES exist in DB (jsonb), so we keep it
        const { timeline, tagNumber, ...supabaseUpdates } = updates;
        
        // Remove immutable fields that should never be updated
        const { id: _id, createdAt: _createdAt, ...mutableFields } = supabaseUpdates;
        
        // Clean any remaining extras that might have slipped through
        const cleanUpdates = removeExtrasFromObject(mutableFields);
        
        // Ensure jsonb fields are proper JSON objects, not strings
        const updateData = { ...cleanUpdates };
        
        // Convert history to proper JSON if it's a string
        if (updateData.history && typeof updateData.history === 'string') {
          try {
            updateData.history = JSON.parse(updateData.history);
          } catch (e) {
            console.warn('[DB.update] Failed to parse history as JSON:', e);
            delete updateData.history;
          }
        }
        
        // Convert quote to proper JSON if it's a string
        if (updateData.quote && typeof updateData.quote === 'string') {
          try {
            updateData.quote = JSON.parse(updateData.quote);
          } catch (e) {
            console.warn('[DB.update] Failed to parse quote as JSON:', e);
          }
        }
        
        // Always set updatedAt
        updateData.updatedAt = new Date().toISOString();

        // Log the payload before sending (for debugging)
        console.log('[DB.update] Sending PATCH:', {
          id,
          payload: JSON.stringify(updateData),
          payloadKeys: Object.keys(updateData)
        });

        // Enhanced error logging: capture full response details
        // Use explicit column selection to avoid requesting non-existent columns
        const { data, error } = await sb
          .from('tickets')
          .update(updateData)
          .eq('id', id)
          .select('id, createdAt, updatedAt, ticketNumber, customerName, customerPhone, customerEmail, bikeModel, issueDescription, status, priority, internalNotes, is_archived, history, quote')
          .single();

        if (error) {
          // Log comprehensive error details with response body
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'unknown';
          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
          const redactedKey = anonKey.length > 6 ? `...${anonKey.slice(-6)}` : '***';
          
          const errorDetails = {
            method: 'PATCH',
            url: `${supabaseUrl}/rest/v1/tickets?id=eq.${id}`,
            payload: JSON.stringify(updateData),
            payloadKeys: Object.keys(updateData),
            status: error.status || 'unknown',
            message: error.message || String(error),
            details: error.details || null,
            hint: error.hint || null,
            code: error.code || null,
            apikey: redactedKey
          };
          
          console.error('[DB.update] Failed PATCH request:', errorDetails);
          console.error('[DB.update] Full error object:', error);
          
          // Try to extract response body from Supabase error
          let responseBody = null;
          if (error.response) {
            try {
              // Supabase JS may expose response differently
              if (typeof error.response.text === 'function') {
                responseBody = await error.response.text();
              } else if (error.response.body) {
                responseBody = typeof error.response.body === 'string' 
                  ? error.response.body 
                  : JSON.stringify(error.response.body);
              } else if (error.response.data) {
                responseBody = typeof error.response.data === 'string'
                  ? error.response.data
                  : JSON.stringify(error.response.data);
              }
            } catch (e) {
              console.warn('[DB.update] Could not extract response body:', e);
            }
          }
          
          // Log response body if available
          if (responseBody) {
            console.error('[DB.update] Response body:', responseBody);
          }
          
          // Supabase JS client wraps errors, log all available properties
          if (error.context) {
            console.error('[DB.update] Error context:', error.context);
          }
          
          Utils.showToast("שגיאה בעדכון", "error");
          throw error;
        }

        // Store timeline and tagNumber in localStorage (they don't exist in DB)
        // history is stored in DB, so we get it from the response
        const existingExtras = JSON.parse(localStorage.getItem(`ticket_extras_${id}`) || '{}');
        const newExtras = {
          timeline: timeline !== undefined ? timeline : (existingExtras.timeline || []),
          tagNumber: tagNumber !== undefined ? tagNumber : (existingExtras.tagNumber || null)
        };
        
        // Update localStorage if extras were provided
        if (timeline !== undefined || tagNumber !== undefined) {
          localStorage.setItem(`ticket_extras_${id}`, JSON.stringify(newExtras));
        }
        
        // Merge extras from localStorage with Supabase data
        // history comes from DB response, timeline/tagNumber from localStorage
        return {
          ...data,
          timeline: newExtras.timeline,
          tagNumber: newExtras.tagNumber
        };
      } catch (e) {
        console.error("Failed to update ticket:", e.message || e, e.details || '');
        Utils.showToast("שגיאה בעדכון התיקון", "error");
        throw e;
      }
    },

    // Initialize migration on first use
    init: migrateLegacyData
  };
}

export const BikeDB = {
  KEY: 'bikecare_bikes_inventory',
  getAll: () => JSON.parse(localStorage.getItem(BikeDB.KEY) || '[]'),
  save: (data) => localStorage.setItem(BikeDB.KEY, JSON.stringify(data)),

  // Updated: no Utils param, no need to change existing calls
  add: (bike) => {
    const list = BikeDB.getAll();
    const newBike = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...bike };
    list.unshift(newBike);
    BikeDB.save(list);
    return newBike;
  },

  update: (id, updates) => {
    const list = BikeDB.getAll();
    const idx = list.findIndex(b => b.id === id);
    if (idx > -1) {
      list[idx] = { ...list[idx], ...updates };
      BikeDB.save(list);
    }
  },

  delete: (id) => {
    let list = BikeDB.getAll();
    list = list.filter(b => b.id !== id);
    BikeDB.save(list);
  }
};
