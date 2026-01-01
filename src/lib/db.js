export function createDB(sb, Utils) {
  /**
   * Maps camelCase frontend field names to lowercase database column names
   * PostgREST is case-sensitive and requires exact column name matches
   */
  const buildTicketPayload = (formState, isUpdate = false) => {
    if (!formState || typeof formState !== 'object') return {};
    
    const payload = {};
    
    // Map camelCase to lowercase column names
    if (formState.tagNumber !== undefined) payload.tagnumber = formState.tagNumber;
    if (formState.ticketNumber !== undefined) payload.ticketnumber = formState.ticketNumber;
    if (formState.customerName !== undefined) payload.customername = formState.customerName;
    if (formState.customerPhone !== undefined) payload.customerphone = formState.customerPhone;
    if (formState.customerEmail !== undefined) payload.customeremail = formState.customerEmail;
    if (formState.bikeModel !== undefined) payload.bikemodel = formState.bikeModel;
    if (formState.issueDescription !== undefined) payload.issuedescription = formState.issueDescription;
    if (formState.status !== undefined) payload.status = formState.status;
    if (formState.priority !== undefined) payload.priority = formState.priority;
    if (formState.internalNotes !== undefined) payload.internalnotes = formState.internalNotes;
    if (formState.is_archived !== undefined) payload.is_archived = formState.is_archived;
    
    // Handle jsonb fields - ensure they are proper JSON objects/arrays
    if (formState.history !== undefined) {
      if (typeof formState.history === 'string') {
        try {
          payload.history = JSON.parse(formState.history);
        } catch (e) {
          payload.history = [];
        }
      } else {
        payload.history = Array.isArray(formState.history) ? formState.history : [];
      }
    }
    
    if (formState.quote !== undefined) {
      if (typeof formState.quote === 'string') {
        try {
          payload.quote = JSON.parse(formState.quote);
        } catch (e) {
          payload.quote = null;
        }
      } else if (formState.quote === null) {
        payload.quote = null;
      } else {
        payload.quote = formState.quote;
      }
    }
    
    // For updates: always set updatedAt, never include id or createdAt
    if (isUpdate) {
      payload.updatedat = new Date().toISOString();
    } else {
      // For inserts: include createdAt and updatedAt
      payload.createdat = formState.createdAt || new Date().toISOString();
      payload.updatedat = formState.updatedAt || new Date().toISOString();
    }
    
    // Remove undefined values
    Object.keys(payload).forEach(key => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });
    
    return payload;
  };

  /**
   * Maps lowercase database column names back to camelCase for frontend
   */
  const mapDbToFrontend = (dbRow) => {
    if (!dbRow) return dbRow;
    
    return {
      ...dbRow,
      tagNumber: dbRow.tagnumber,
      ticketNumber: dbRow.ticketnumber,
      customerName: dbRow.customername,
      customerPhone: dbRow.customerphone,
      customerEmail: dbRow.customeremail,
      bikeModel: dbRow.bikemodel,
      issueDescription: dbRow.issuedescription,
      internalNotes: dbRow.internalnotes,
      is_archived: dbRow.is_archived,
      createdAt: dbRow.createdat,
      updatedAt: dbRow.updatedat,
      // jsonb fields are already in correct format
      history: dbRow.history || [],
      quote: dbRow.quote || null
    };
  };

  /**
   * Helper to remove fields that don't exist in Supabase schema
   * This prevents PGRST204 errors when these fields are accidentally included
   * NOTE: timeline doesn't exist in DB, stored in localStorage
   */
  const removeExtrasFromObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = { ...obj };
    // Remove timeline (it doesn't exist in DB, stored in localStorage)
    delete clean.timeline;
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
          .select('id, createdat, updatedat, ticketnumber, tagnumber, customername, customerphone, customeremail, bikemodel, issuedescription, status, priority, internalnotes, is_archived, history, quote')
          .order('createdat', { ascending: false });

        if (error) {
          console.error("Supabase Error:", error.message || error, error.details || '');
          Utils.showToast("שגיאה בטעינת הנתונים", "error");
          return [];
        }

        // Map DB lowercase columns to camelCase frontend format
        // Merge with localStorage extras (timeline, tagNumber)
        return (data || []).map(dbRow => {
          const ticket = mapDbToFrontend(dbRow);
          const extras = JSON.parse(localStorage.getItem(`ticket_extras_${ticket.id}`) || '{}');
          return {
            ...ticket,
            timeline: extras.timeline || [],
            tagNumber: extras.tagNumber !== undefined ? extras.tagNumber : (ticket.tagNumber || null),
            quote: ticket.quote || { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false }
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
        // Extract timeline (doesn't exist in DB, stored in localStorage)
        const { timeline, ...ticketForDb } = ticket;
        
        // Build payload with lowercase column names
        const payload = buildTicketPayload({
          ...ticketForDb,
          id: Utils.id(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, false);

        const { data, error } = await sb
          .from('tickets')
          .insert([payload])
          .select('id, createdat, updatedat, ticketnumber, tagnumber, customername, customerphone, customeremail, bikemodel, issuedescription, status, priority, internalnotes, is_archived, history, quote')
          .single();

        if (error) {
          console.error("Error saving ticket:", error.message || error, error.details || '');
          Utils.showToast("שגיאה בשמירה", "error");
          throw error;
        }

        // Store timeline in localStorage (it doesn't exist in DB)
        const extras = {
          timeline: timeline || [],
          tagNumber: data.tagnumber || null
        };
        localStorage.setItem(`ticket_extras_${data.id}`, JSON.stringify(extras));

        // Map DB response to frontend format and merge extras
        const mappedTicket = mapDbToFrontend(data);
        return {
          ...mappedTicket,
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

        // Extract timeline (doesn't exist in DB, stored in localStorage)
        const { timeline, ...updatesForDb } = updates;
        
        // Build payload with lowercase column names (excludes id, createdAt automatically)
        const payload = buildTicketPayload(updatesForDb, true);

        // Log the payload before sending (for debugging)
        console.log('[DB.update] Sending PATCH:', {
          id,
          payload: JSON.stringify(payload),
          payloadKeys: Object.keys(payload)
        });

        // Enhanced error logging: capture full response details
        // Use explicit lowercase column selection
        const { data, error } = await sb
          .from('tickets')
          .update(payload)
          .eq('id', id)
          .select('id, createdat, updatedat, ticketnumber, tagnumber, customername, customerphone, customeremail, bikemodel, issuedescription, status, priority, internalnotes, is_archived, history, quote')
          .single();

        if (error) {
          // Log comprehensive error details with response body
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'unknown';
          const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
          const redactedKey = anonKey.length > 6 ? `...${anonKey.slice(-6)}` : '***';
          
          const errorDetails = {
            method: 'PATCH',
            url: `${supabaseUrl}/rest/v1/tickets?id=eq.${id}`,
            payload: JSON.stringify(payload),
            payloadKeys: Object.keys(payload),
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

        // Store timeline in localStorage (it doesn't exist in DB)
        const existingExtras = JSON.parse(localStorage.getItem(`ticket_extras_${id}`) || '{}');
        const newExtras = {
          timeline: timeline !== undefined ? timeline : (existingExtras.timeline || []),
          tagNumber: data.tagnumber || existingExtras.tagNumber || null
        };
        
        // Update localStorage if timeline was provided
        if (timeline !== undefined) {
          localStorage.setItem(`ticket_extras_${id}`, JSON.stringify(newExtras));
        }
        
        // Map DB response to frontend format and merge extras
        const mappedTicket = mapDbToFrontend(data);
        return {
          ...mappedTicket,
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
