export const Utils = {
  formatCurrency: (num) =>
    new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(num),

  formatDate: (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  },

  id: () => crypto.randomUUID(),

  /**
   * Sanitize user input to prevent XSS attacks
   * Escapes HTML special characters
   */
  escapeHtml: (unsafe) => {
    if (unsafe == null) return '';
    const text = String(unsafe);
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  },

  /**
   * Sanitize text for use in HTML attributes
   */
  escapeAttr: (unsafe) => {
    if (unsafe == null) return '';
    return String(unsafe).replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  },

  showToast: (msg, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    const bgClass =
      type === 'error'
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-green-50 text-green-800 border-green-200';
    el.className = `toast flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border mb-2 ${bgClass}`;
    // Use textContent instead of innerHTML for toast messages
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
};
