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
          
          if (extras.history || extras.timeline || extras.tagNumber !== undefined) {
            const updateData = {
              history: extras.history || null,
              timeline: extras.timeline || null,
              tagNumber: extras.tagNumber || null,
              updatedAt: new Date().toISOString()
            };
            
            const { error } = await sb.from('tickets').update(updateData).eq('id', ticketId);
            if (!error) {
              localStorage.removeItem(key); // Clean up after successful migration
            }
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
          console.error("Supabase Error:", error);
          Utils.showToast("שגיאה בטעינת הנתונים", "error");
          return [];
        }

        // Ensure all tickets have default values for optional fields
        return (data || []).map(t => ({
          ...t,
          history: t.history || [],
          timeline: t.timeline || [],
          quote: t.quote || { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false }
        }));
      } catch (e) {
        console.error("DB Connection Error:", e);
        Utils.showToast("שגיאה בחיבור למסד הנתונים", "error");
        return [];
      }
    },

    add: async (ticket) => {
      try {
        const newTicket = {
          id: Utils.id(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          // Store all fields including history, timeline, tagNumber in Supabase
          history: ticket.history || [],
          timeline: ticket.timeline || [],
          tagNumber: ticket.tagNumber || null,
          ...ticket
        };

        const { data, error } = await sb.from('tickets').insert([newTicket]).select().single();

        if (error) {
          console.error("Error saving ticket:", error);
          Utils.showToast("שגיאה בשמירה", "error");
          throw error;
        }

        return data || newTicket;
      } catch (e) {
        console.error("Failed to add ticket:", e);
        Utils.showToast("שגיאה בשמירת התיקון", "error");
        throw e;
      }
    },

    update: async (id, updates) => {
      try {
        const updateData = {
          ...updates,
          updatedAt: new Date().toISOString()
        };

        const { data, error } = await sb
          .from('tickets')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          console.error("Update Error:", error);
          Utils.showToast("שגיאה בעדכון", "error");
          throw error;
        }

        return data;
      } catch (e) {
        console.error("Failed to update ticket:", e);
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
