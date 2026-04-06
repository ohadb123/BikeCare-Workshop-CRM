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
              tagnumber: extras.tagnumber || extras.tagNumber || null,
              updatedat: new Date().toISOString()
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
    getAll: async ({ limit = 50, offset = 0, searchTerm = '' } = {}) => {
      if (!sb) return [];
      try {
        let query = sb
          .from('tickets')
          .select('*')
          .order('createdat', { ascending: false })
          .range(offset, offset + limit - 1);

        if (searchTerm) {
          const term = searchTerm.trim();
          const isNumeric = /^\d+$/.test(term);

          let orQuery = `"customerName".ilike.%${term}%,"bikeModel".ilike.%${term}%,tagnumber.ilike.%${term}%,"customerPhone".ilike.%${term}%`;

          if (isNumeric) {
            orQuery += `,"ticketNumber".eq.${term}`;
          }

          query = query.or(orQuery);
        }

        const { data, error } = await query;

        if (error) {
          console.error("Supabase Error:", error);
          Utils.showToast("שגיאה בטעינת הנתונים", "error");
          return [];
        }

        // Strip heavy JSON columns from the list — fetched on demand via getById
        return (data || []).map(({ history, timeline, ...t }) => ({
          ...t,
          quote: t.quote || { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false }
        }));
      } catch (e) {
        console.error("DB Connection Error:", e);
        Utils.showToast("שגיאה בחיבור למסד הנתונים", "error");
        return [];
      }
    },

    getById: async (id) => {
      if (!sb) return null;
      try {
        const { data, error } = await sb
          .from('tickets')
          .select('*')
          .eq('id', id)
          .single();

        if (error) {
          console.error("Supabase Error:", error);
          return null;
        }

        return {
          ...data,
          history: data.history || [],
          timeline: data.timeline || [],
          quote: data.quote || { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false }
        };
      } catch (e) {
        console.error("DB Connection Error:", e);
        return null;
      }
    },

    add: async (ticket) => {
      try {
        const { tagNumber, ...rest } = ticket;
        const newTicket = {
          id: Utils.id(),
          createdat: new Date().toISOString(),
          updatedat: new Date().toISOString(),
          ...rest,
          history: rest.history || [],
          timeline: rest.timeline || [],
          tagnumber: tagNumber ?? rest.tagnumber ?? null,
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
        const { tagNumber, ...rest } = updates;
        const updateData = {
          ...rest,
          updatedat: new Date().toISOString(),
          ...(tagNumber !== undefined && { tagnumber: tagNumber }),
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

    getGlobalStatusCounts: async () => {
      if (!sb) return null;
      try {
        const { data, error } = await sb
          .from('tickets')
          .select('status')
          .eq('is_archived', false)
          .neq('status', 'archived');

        if (error) {
          console.error('getGlobalStatusCounts error:', error);
          return null;
        }

        const counts = {
          new: 0, new_bike: 0, test_bike: 0,
          in_progress: 0, waiting_approval: 0,
          completed: 0, cancelled: 0
        };
        for (const row of data || []) {
          if (counts[row.status] !== undefined) counts[row.status]++;
        }
        return counts;
      } catch (e) {
        console.error('getGlobalStatusCounts error:', e);
        return null;
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
