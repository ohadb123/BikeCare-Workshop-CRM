export function createDB(sb, Utils) {
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

  return {
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
        
        const newTicket = {
          id: Utils.id(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...supabaseFields
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
        // Extract fields that don't exist in Supabase schema
        const { history, timeline, tagNumber, ...supabaseUpdates } = updates;
        
        const updateData = {
          ...supabaseUpdates,
          updatedAt: new Date().toISOString()
        };

        const { data, error } = await sb
          .from('tickets')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          console.error("Update Error:", error.message || error, error.details || '');
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
