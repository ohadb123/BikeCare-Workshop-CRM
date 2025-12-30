export const Utils = {
  formatCurrency: (num) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(num),

  formatDate: (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  },

  id: () => crypto.randomUUID(),

  showToast: (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    const bgClass =
      type === 'error'
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-green-50 text-green-800 border-green-200';
    el.className = `toast flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border mb-2 ${bgClass}`;
    el.innerHTML = `<span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
};
