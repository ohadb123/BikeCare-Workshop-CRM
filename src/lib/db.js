export function createDB(sb, Utils) {
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
          return [];
        }

        // Merge with local extras
        return data.map(t => {
          const extras = JSON.parse(localStorage.getItem(`ticket_extras_${t.id}`) || '{}');
          return { ...t, ...extras };
        });
      } catch (e) {
        console.error("DB Connection Error:", e);
        return [];
      }
    },

    add: async (ticket) => {
      const { history, timeline, tagNumber, ...core } = ticket;

      const newTicket = {
        id: Utils.id(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...core
      };

      const { error } = await sb.from('tickets').insert([newTicket]);

      if (error) {
        console.error("Error saving:", error);
        Utils.showToast("שגיאה בשמירה", "error");
        throw error;
      }

      if (history || timeline || tagNumber) {
        localStorage.setItem(
          `ticket_extras_${newTicket.id}`,
          JSON.stringify({ history, timeline, tagNumber })
        );
      }

      return newTicket;
    },

    update: async (id, updates) => {
      const { history, timeline, tagNumber, ...coreUpdates } = updates;

      if (Object.keys(coreUpdates).length > 0) {
        const updateData = { ...coreUpdates, updatedAt: new Date().toISOString() };
        const { error } = await sb.from('tickets').update(updateData).eq('id', id);
        if (error) console.error("Update Error:", error);
      }

      if (history || timeline || tagNumber !== undefined || updates.is_archived !== undefined) {
        const currentExtras = JSON.parse(localStorage.getItem(`ticket_extras_${id}`) || '{}');
        const newExtras = { ...currentExtras, ...updates };
        if (history) newExtras.history = history;
        if (timeline) newExtras.timeline = timeline;
        if (tagNumber !== undefined) newExtras.tagNumber = tagNumber;
        localStorage.setItem(`ticket_extras_${id}`, JSON.stringify(newExtras));
      }
    }
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
