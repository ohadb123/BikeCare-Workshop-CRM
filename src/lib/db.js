export function createDB(sb, Utils) {
  /**
   * Helper to remove fields that don't exist in Supabase schema
   * This prevents PGRST204 errors when these fields are accidentally included
   */
  const removeExtrasFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = { ...obj };
    // Explicitly remove these fields to prevent any chance of them being sent to Supabase
    delete clean.history;
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
        // Merge with localStorage extras (history, timeline, tagNumber)
        return (data || []).map(t => {
          const extras = JSON.parse(localStorage.getItem(`ticket_extras_${t.id}`) || '{}');
          return {
            ...t,
            history: extras.history || t.history || [],
            timeline: extras.timeline || t.timeline || [],
            tagNumber: extras.tagNumber !== undefined ? extras.tagNumber : (t.tagNumber || null),
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
        // Extract fields that don't exist in Supabase schema
        const { history, timeline, tagNumber, ...supabaseFields } = ticket;
        
        // Clean any remaining extras that might have slipped through
        const cleanFields = removeExtrasFromObject(supabaseFields);
        
        const newTicket = {
          id: Utils.id(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...cleanFields
        };

        const { data, error } = await sb.from('tickets').insert([newTicket]).select().single();

        if (error) {
          console.error("Error saving ticket:", error.message || error, error.details || '');
          Utils.showToast("שגיאה בשמירה", "error");
          throw error;
        }

        // Store extras in localStorage (always store to ensure consistency)
        const extras = {
          history: history || [],
          timeline: timeline || [],
          tagNumber: tagNumber || null
        };
        localStorage.setItem(`ticket_extras_${data.id}`, JSON.stringify(extras));

        // Merge extras with Supabase data
        return {
          ...data,
          history: extras.history,
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
          throw new Error('Update blocked: not from explicit user action');
        }

        // Extract fields that don't exist in Supabase schema
        const { history, timeline, tagNumber, ...supabaseUpdates } = updates;
        
        // Clean any remaining extras that might have slipped through
        const cleanUpdates = removeExtrasFromObject(supabaseUpdates);
        
        const updateData = {
          ...cleanUpdates,
          updatedAt: new Date().toISOString()
        };

        // Enhanced error logging: capture full response details
        const { data, error } = await sb
          .from('tickets')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          // Log comprehensive error details
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'unknown';
          const errorDetails = {
            method: 'PATCH',
            url: `${supabaseUrl}/rest/v1/tickets?id=eq.${id}`,
            payload: JSON.stringify(updateData),
            status: error.status || 'unknown',
            message: error.message || String(error),
            details: error.details || null,
            hint: error.hint || null,
            code: error.code || null
          };
          
          console.error('[DB.update] Failed PATCH request:', errorDetails);
          console.error('[DB.update] Full error object:', error);
          
          // Supabase JS client wraps errors, log all available properties
          if (error.context) {
            console.error('[DB.update] Error context:', error.context);
          }
          if (error.response) {
            console.error('[DB.update] Error response object:', error.response);
          }
          
          Utils.showToast("שגיאה בעדכון", "error");
          throw error;
        }

        // Always merge extras from localStorage (whether updated or not)
        const existingExtras = JSON.parse(localStorage.getItem(`ticket_extras_${id}`) || '{}');
        const newExtras = {
          history: history !== undefined ? history : (existingExtras.history || []),
          timeline: timeline !== undefined ? timeline : (existingExtras.timeline || []),
          tagNumber: tagNumber !== undefined ? tagNumber : (existingExtras.tagNumber || null)
        };
        
        // Update localStorage if extras were provided
        if (history !== undefined || timeline !== undefined || tagNumber !== undefined) {
          localStorage.setItem(`ticket_extras_${id}`, JSON.stringify(newExtras));
        }
        
        // Always merge extras with Supabase data
        return {
          ...data,
          history: newExtras.history,
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
