import { createSupabaseClient } from './lib/supabaseClient.js';
import { createDB, BikeDB } from './lib/db.js';
import { Utils } from './lib/utils.js';

    // --- הגדרות Supabase ---
const sb = createSupabaseClient();

  // --- Utils ---
const DB = createDB(sb, Utils);


    // --- Colors Map for Pie Chart ---
    const STATUS_COLORS = {
        new: '#3b82f6', // blue-500
        in_progress: '#eab308', // yellow-500
        waiting_approval: '#a855f7', // purple-500
        completed: '#22c55e', // green-500
        cancelled: '#6b7280', // gray-500
        new_bike: '#14b8a6', // teal-500
        test_bike: '#f97316', // orange-500
        second_hand: '#6366f1', // indigo-500
        archived: '#9ca3af' // gray-400
    };

    // --- Actions/Statuses Map for Operational Dashboard ---
    const ACTION_TEXTS = {
        new: 'מומלץ ליצור קשר ראשוני לאיסוף פרטים ולהבנת הצורך.',
        waiting_approval: 'יש לוודא שהלקוח קיבל את ההצעה וכי הכל ברור מבחינתו.',
        in_progress: 'מומלץ לעדכן את הלקוח לגבי סטטוס הטיפול והשלבים הבאים.',
        completed: 'מומלץ לתאם מועד מסירה או איסוף עם הלקוח.',
        cancelled: 'אין פעולה נדרשת – ניתן להעביר לארכיון במידת הצורך.',
        new_bike: 'יש לעדכן היכן עומד תהליך הבנייה ולהעביר מידע בהתאם.',
        test_bike: 'מומלץ ליצור קשר לקבלת משוב ולתאם את המשך התהליך.',
        archived: 'התיקון נמצא בארכיון.'
    };

	
    // --- CANVAS MODE DETECTOR ---
    const CANVAS_MODE = new URLSearchParams(window.location.search).get("canvas") === "1" || localStorage.getItem("CANVAS_MODE") === "1";

    // --- App Logic ---
    window.app = {
        tickets: [],
        bikes: [],
        currentTicket: null,
        currentCustomer: null,
        currentBike: null,
        sortState: { field: 'createdAt', dir: 'desc' },
        activeTicketTab: 'details',
        isEditingDetails: false,
        user: null,
        chartInstance: null,
        
        // Flags
        started: false,
        listenersBound: false,
        refreshIntervalId: null,

        init: async () => {
            if(!sb) {
                alert("Supabase client failed to initialize. Check console.");
                return;
            }

            // --- CANVAS MODE BYPASS ---
            if (CANVAS_MODE) {
                console.log("Starting in Canvas Mode (No Auth)");
                window.app.user = { id: "canvas", email: "canvas@local" };
                window.app.startApp();
                return;
            }
            // --------------------------

            const { data: { session } } = await sb.auth.getSession();
            
            if (session) {
                window.app.user = session.user;
                window.app.startApp();
            } else {
                window.app.showLogin();
            }

            sb.auth.onAuthStateChange((event, session) => {
                if (session) {
                    window.app.user = session.user;
                    window.app.startApp();
                } else {
                    window.app.started = false;
                    window.app.listenersBound = false;
                    if (window.app.refreshIntervalId) clearInterval(window.app.refreshIntervalId);
                    window.app.user = null;
                    window.app.showLogin();
                }
            });
            
            lucide.createIcons();
        },

        startApp: async () => {
            if (window.app.started) return;
            window.app.started = true;

            // Auth Check (Allowlist) - Only if NOT in Canvas Mode
            if (!CANVAS_MODE) {
                const { data: allowRow, error: allowErr } = await sb
                    .from('allowed_users')
                    .select('email')
                    .eq('email', window.app.user?.email || '')
                    .maybeSingle();

                if (allowErr || !allowRow) {
                    await sb.auth.signOut();
                    window.app.user = null;
                    window.app.showLogin();
                    Utils.showToast('אין לך הרשאה להיכנס למערכת. פנה למנהל המערכת.', 'error');
                    return;
                }
            }

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-container').classList.remove('hidden');
            
            window.app.tickets = await DB.getAll();
            window.app.bikes = BikeDB.getAll();
            
            window.app.setupListeners();
            router.navigate('dashboard');
            
            if (window.app.refreshIntervalId) clearInterval(window.app.refreshIntervalId);
            window.app.refreshIntervalId = setInterval(async () => {
                if(document.visibilityState === 'visible' && window.app.user) {
                    const freshData = await DB.getAll();
                    if (freshData.length !== window.app.tickets.length) {
                          window.app.tickets = freshData;
                          const currentView = document.querySelector('.view-section.active').id;
                          if(currentView === 'view-dashboard') window.app.renderDashboard();
                          if(currentView === 'view-tickets') window.app.renderTickets();
                          if(currentView === 'view-archive') window.app.renderArchive();
                    } else {
                        window.app.tickets = freshData;
                    }
                }
            }, 10000);
        },

        showLogin: () => {
            // Prevent login screen in Canvas Mode
            if (CANVAS_MODE) {
                window.app.startApp();
                return;
            }
            document.getElementById('app-container').classList.add('hidden');
            document.getElementById('login-screen').style.display = 'flex';
        },

        signInWithGoogle: async () => {
            const redirectTo = `${window.location.origin}/`; 
            const { data, error } = await sb.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo }
            });
            if (error) Utils.showToast(error.message, 'error');
        },

        signOut: async () => {
            if (!CANVAS_MODE) {
                await sb.auth.signOut();
            }
            window.location.reload();
        },

        setupListeners: () => {
            if (window.app.listenersBound) return;
            window.app.listenersBound = true;

            document.getElementById('tickets-search').addEventListener('input', window.app.renderTickets);
            document.getElementById('tickets-filter').addEventListener('change', window.app.renderTickets);
            const custSearch = document.getElementById('customers-search');
            if(custSearch) custSearch.addEventListener('input', window.app.renderCustomers);
            
            const createTicketForm = document.getElementById('create-ticket-form');
            createTicketForm.onsubmit = async (e) => {
                e.preventDefault();
                console.count("create-ticket submit fired");

                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData.entries());
                
                if (data.ticketNumber) {
                    data.ticketNumber = parseInt(data.ticketNumber);
                }
                
                try {
                    const nextId = window.app.getNextTicketNumber();
                    
                    await DB.add({
                        ...data,
                        ticketNumber: nextId,
                        status: 'new',
                        quote: { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false },
                        timeline: [],
                        history: [{date: new Date().toISOString(), action: 'נוצר', user: window.app.user.email}]
                    });
                    
                    window.app.tickets = await DB.getAll();
                    e.target.reset();
                    Utils.showToast('כרטיס נפתח בהצלחה');
                    router.navigate('tickets');
                } catch(err) {
                    console.error(err);
                }
            };

            const bikeForm = document.getElementById('bike-form');
            bikeForm.onsubmit = (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData.entries());
                const id = data.id; 
                delete data.id;

                if (id) {
                    BikeDB.update(id, data);
                    Utils.showToast('אופניים עודכנו');
                } else {
                    BikeDB.add(data);
                    Utils.showToast('אופניים נוספו למלאי');
                }
                window.app.bikes = BikeDB.getAll();
                window.app.renderBikes();
                router.navigate('secondhand');
            };
        },

        getCustomers: () => {
            const custMap = new Map();
            window.app.tickets.forEach(t => {
                if(t.customerName && t.customerPhone) {
                    if(!custMap.has(t.customerPhone)) {
                         custMap.set(t.customerPhone, {
                             name: t.customerName,
                             phone: t.customerPhone,
                             email: t.customerEmail || ''
                         });
                    }
                }
            });
            return Array.from(custMap.values());
        },

        onCustomerNameInput: (input) => {
            const val = input.value;
            const customers = window.app.getCustomers();
            const found = customers.find(c => c.name === val);
            
            if (found) {
                const form = document.getElementById('create-ticket-form');
                form.querySelector('[name="customerPhone"]').value = found.phone;
                form.querySelector('[name="customerEmail"]').value = found.email;
                Utils.showToast('פרטי לקוח מולאו אוטומטית');
            }
        },

        getNextTicketNumber: () => {
            const numbers = window.app.tickets.map(t => parseInt(t.ticketNumber) || 0);
            const max = numbers.length > 0 ? Math.max(...numbers) : 0;
            return Math.max(max + 1, 2400);
        },

        handleSort: (field) => {
            if (window.app.sortState.field === field) {
                window.app.sortState.dir = window.app.sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                window.app.sortState.field = field;
                window.app.sortState.dir = 'asc';
            }
            window.app.renderTickets();
        },

        getPriorityValue: (p) => {
            const map = { 'normal': 1, 'high': 2, 'urgent': 3 };
            return map[p] || 0;
        },

        openCreateTicket: (prefillData = null) => {
            router.navigate('create-ticket');
            const form = document.getElementById('create-ticket-form');
            if(form) {
                 form.reset();
                 const nextId = window.app.getNextTicketNumber();
                 form.querySelector('[name="ticketNumber"]').value = nextId;

                 const datalist = document.getElementById('customers-datalist');
                 if(datalist) {
                     const customers = window.app.getCustomers();
                     datalist.innerHTML = customers.map(c => `<option value="${c.name}">${c.phone}</option>`).join('');
                 }
            }
            
            if (prefillData && form) {
                if(prefillData.name) form.querySelector('[name="customerName"]').value = prefillData.name;
                if(prefillData.phone) form.querySelector('[name="customerPhone"]').value = prefillData.phone;
                if(prefillData.email) form.querySelector('[name="customerEmail"]').value = prefillData.email;
            }
        },

        filterTicketsByStatus: (status) => {
            router.navigate('tickets');
            const dropdown = document.getElementById('tickets-filter');
            if(dropdown) {
                dropdown.value = status;
                dropdown.dispatchEvent(new Event('change'));
            }
        },
        
        getDaysColor: (days) => {
            if (days <= 2) return 'bg-gray-100 text-gray-600 border-gray-200';
            if (days <= 5) return 'bg-orange-50 text-orange-600 border-orange-200';
            return 'bg-red-50 text-red-600 border-red-200';
        },
        
        renderDashboard: () => {
            // סינון ארכיון מהדשבורד (גם לפי דגל וגם לפי סטטוס)
            const t = window.app.tickets.filter(x => !x.is_archived && x.status !== 'archived');
            
            const counts = {
                new: t.filter(x => x.status === 'new').length,
                new_bike: t.filter(x => x.status === 'new_bike').length,
                test_bike: t.filter(x => x.status === 'test_bike').length,
                in_progress: t.filter(x => x.status === 'in_progress').length,
                waiting_approval: t.filter(x => x.status === 'waiting_approval').length,
                completed: t.filter(x => x.status === 'completed').length,
                cancelled: t.filter(x => x.status === 'cancelled').length,
                second_hand: window.app.bikes.length
            };

            document.getElementById('stat-new').innerText = counts.new;
            document.getElementById('stat-new_bike').innerText = counts.new_bike;
            document.getElementById('stat-test_bike').innerText = counts.test_bike;
            document.getElementById('stat-in_progress').innerText = counts.in_progress;
            document.getElementById('stat-waiting_approval').innerText = counts.waiting_approval;
            document.getElementById('stat-completed').innerText = counts.completed;
            document.getElementById('stat-cancelled').innerText = counts.cancelled;
            document.getElementById('stat-second_hand').innerText = counts.second_hand;

            // --- Pie Chart Rendering ---
            const chartCtx = document.getElementById('dashboard-pie-chart').getContext('2d');
            
            const dataMap = [
                { label: 'חדש', value: counts.new, color: STATUS_COLORS.new },
                { label: 'ממתין לאישור', value: counts.waiting_approval, color: STATUS_COLORS.waiting_approval },
                { label: 'בטיפול', value: counts.in_progress, color: STATUS_COLORS.in_progress },
                { label: 'אופניים חדשים', value: counts.new_bike, color: STATUS_COLORS.new_bike },
                { label: 'אופני מבחן', value: counts.test_bike, color: STATUS_COLORS.test_bike },
                { label: 'יד שנייה', value: counts.second_hand, color: STATUS_COLORS.second_hand }
            ].filter(item => item.value > 0);

            if (dataMap.length === 0) {
                document.getElementById('no-data-msg').classList.remove('hidden');
                if (window.app.chartInstance) {
                    window.app.chartInstance.destroy();
                    window.app.chartInstance = null;
                }
            } else {
                document.getElementById('no-data-msg').classList.add('hidden');
                const total = dataMap.reduce((sum, item) => sum + item.value, 0);
                
                if (window.app.chartInstance) window.app.chartInstance.destroy();
                
                const percentagePlugin = {
                    id: 'percentageLabels',
                    afterDatasetsDraw(chart) {
                        const { ctx } = chart;
                        chart.data.datasets.forEach((dataset, i) => {
                            const meta = chart.getDatasetMeta(i);
                            meta.data.forEach((element, index) => {
                                const value = dataset.data[index];
                                const percent = Math.round((value / total) * 100);
                                if (percent > 5) {
                                    const { x, y } = element.tooltipPosition();
                                    ctx.fillStyle = '#fff';
                                    ctx.font = 'bold 11px Heebo';
                                    ctx.textAlign = 'center';
                                    ctx.textBaseline = 'middle';
                                    ctx.fillText(`${percent}%`, x, y);
                                }
                            });
                        });
                    }
                };

                window.app.chartInstance = new Chart(chartCtx, {
                    type: 'doughnut',
                    data: {
                        labels: dataMap.map(d => d.label),
                        datasets: [{
                            data: dataMap.map(d => d.value),
                            backgroundColor: dataMap.map(d => d.color),
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    font: { family: 'Heebo', size: 11 },
                                    color: '#374151', // gray-700 - explicit color to prevent hover overrides
                                    boxWidth: 10,
                                    generateLabels: (chart) => {
                                        const data = chart.data;
                                        return data.labels.map((label, i) => {
                                            const val = data.datasets[0].data[i];
                                            const pct = Math.round((val / total) * 100);
                                            return {
                                                text: `${label} - ${val} (${pct}%)`,
                                                fillStyle: data.datasets[0].backgroundColor[i],
                                                hidden: false,
                                                index: i
                                            };
                                        });
                                    }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const val = context.raw;
                                        const pct = Math.round((val / total) * 100);
                                        return ` ${context.label}: ${val} (${pct}%)`;
                                    }
                                }
                            }
                        }
                    },
                    plugins: [percentagePlugin]
                });
            }

            const attentionList = document.getElementById('attention-table-body');
            const now = new Date();
            const urgentTickets = t
                .map(ticket => {
                    const updated = new Date(ticket.updatedAt || ticket.createdAt);
                    const diffTime = Math.abs(now - updated);
                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)); 
                    return { ...ticket, diffDays };
                })
                .filter(ticket => {
                    if (ticket.status === 'cancelled' || ticket.status === 'completed') return false;
                    if (ticket.status === 'new') return ticket.diffDays >= 2;
                    return true;
                })
                .sort((a, b) => b.diffDays - a.diffDays)
                .slice(0, 10);
                
            if (urgentTickets.length === 0) {
                attentionList.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">אין פריטים הדורשים טיפול כרגע.</td></tr>`;
            } else {
                attentionList.innerHTML = urgentTickets.map(ticket => {
                    const actionText = ACTION_TEXTS[ticket.status] || 'יש לבדוק סטטוס';
                    const dayColorClass = window.app.getDaysColor(ticket.diffDays);
                    return `
                    <tr class="hover:bg-blue-50 border-b border-gray-50 cursor-pointer" onclick="window.app.openTicket('${ticket.id}')">
                        <td class="p-3 text-gray-800 font-medium">${ticket.customerName}</td>
                        <td class="p-3 text-gray-600">${ticket.bikeModel}</td>
                        <td class="p-3">${window.app.getStatusBadge(ticket.status)}</td>
                        <td class="p-3 text-center">
                            <span class="inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold border ${dayColorClass}">
                                ${ticket.diffDays}
                            </span>
                        </td>
                        <td class="p-3 text-sm text-gray-500 whitespace-normal leading-snug min-w-[200px]">${actionText}</td>
                    </tr>
                    `;
                }).join('');
                lucide.createIcons();
            }
        },

        renderTickets: () => {
            const searchInput = document.getElementById('tickets-search');
            if (!searchInput) return;
            const search = searchInput.value.toLowerCase();
            const filter = document.getElementById('tickets-filter').value;
            const priorityFilter = document.getElementById('priority-filter').value;
            
            let filtered = window.app.tickets.filter(t => {
                if (t.is_archived) return false;
                const matchSearch = (t.customerName || '').toLowerCase().includes(search) || 
                                    (t.ticketNumber || '').toString().includes(search) || 
                                    (t.bikeModel || '').toLowerCase().includes(search) ||
                                    (t.tagNumber || '').toString().includes(search);
                const matchFilter = filter === 'all' || t.status === filter;
                const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
                return matchSearch && matchFilter && matchPriority;
            });

            const { field, dir } = window.app.sortState;
            filtered.sort((a, b) => {
                let valA = a[field], valB = b[field];
                if (field === 'priority') { valA = window.app.getPriorityValue(valA); valB = window.app.getPriorityValue(valB); }
                else if (field === 'createdAt') { valA = new Date(valA); valB = new Date(valB); }
                else if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
                if (valA < valB) return dir === 'asc' ? -1 : 1;
                if (valA > valB) return dir === 'asc' ? 1 : -1;
                return 0;
            });

            document.querySelectorAll('.sort-icon').forEach(icon => {
                icon.setAttribute('data-lucide', 'arrow-up-down');
                icon.classList.remove('text-blue-600');
            });
            const activeIcon = document.getElementById(`sort-icon-${field}`);
            if (activeIcon) {
                activeIcon.setAttribute('data-lucide', dir === 'asc' ? 'arrow-up' : 'arrow-down');
                activeIcon.classList.add('text-blue-600');
            }
            lucide.createIcons();

            const tbody = document.getElementById('tickets-table-body');
            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-500">לא נמצאו תיקונים</td></tr>`;
                return;
            }

            tbody.innerHTML = filtered.map(t => `
                <tr class="hover:bg-blue-50 cursor-pointer border-b border-gray-100" onclick="window.app.openTicket('${t.id}')">
                    <td class="p-4 font-mono font-bold text-blue-600">#${t.ticketNumber}</td>
                    <td class="p-4 font-medium">${t.customerName}</td>
                    <td class="p-4 hidden md:table-cell text-gray-600">${t.customerPhone}</td>
                    <td class="p-4 text-gray-800">${t.bikeModel}</td>
                    <td class="p-4">${window.app.getStatusBadge(t.status)}</td>
                    <td class="p-4 hidden md:table-cell">${window.app.getPriorityLabel(t.priority)}</td>
                    <td class="p-4 text-gray-500 text-sm">${Utils.formatDate(t.createdAt)}</td>
                </tr>
            `).join('');
        },
        
        renderArchive: () => {
            const searchInput = document.getElementById('archive-search');
            const search = searchInput ? searchInput.value.toLowerCase() : '';
            let filtered = window.app.tickets.filter(t => {
                const isArchived = t.is_archived === true;
                const matchSearch = (t.customerName || '').toLowerCase().includes(search) || 
                                    (t.ticketNumber || '').toString().includes(search) || 
                                    (t.bikeModel || '').toLowerCase().includes(search);
                return isArchived && matchSearch;
            });

            const tbody = document.getElementById('archive-table-body');
            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">הארכיון ריק או לא נמצאו תוצאות</td></tr>`;
            } else {
                tbody.innerHTML = filtered.map(t => `
                    <tr class="hover:bg-gray-50 border-b border-gray-100 cursor-pointer text-gray-500" onclick="window.app.openTicket('${t.id}')">
                        <td class="p-4 font-mono">#${t.ticketNumber}</td>
                        <td class="p-4">${t.customerName}</td>
                        <td class="p-4">${t.bikeModel}</td>
                        <td class="p-4 text-xs">${window.app.getStatusBadge(t.status)}</td>
                        <td class="p-4 text-sm">${Utils.formatDate(t.createdAt)}</td>
                    </tr>
                `).join('');
            }
            lucide.createIcons();
        },

        renderCustomers: () => {
            const searchInput = document.getElementById('customers-search');
            const search = searchInput ? searchInput.value.toLowerCase() : '';
            const custMap = new Map();
            window.app.tickets.forEach(t => {
                if(!t.customerPhone) return;
                if(!custMap.has(t.customerPhone)) {
                    custMap.set(t.customerPhone, { 
                        name: t.customerName, phone: t.customerPhone, 
                        email: t.customerEmail, count: 0, last: t.createdAt 
                    });
                }
                const c = custMap.get(t.customerPhone);
                c.count++;
                if(new Date(t.createdAt) > new Date(c.last)) c.last = t.createdAt;
            });

            const customers = Array.from(custMap.values()).filter(c => 
                (c.name || '').toLowerCase().includes(search) || (c.phone || '').includes(search)
            );

            const tbody = document.getElementById('customers-table-body');
            if(tbody) {
                tbody.innerHTML = customers.map(c => `
                    <tr class="hover:bg-blue-50 border-b border-gray-100 cursor-pointer" onclick="window.app.openCustomer('${c.phone}')">
                        <td class="p-4 font-medium">${c.name}</td>
                        <td class="p-4">${c.phone}</td>
                        <td class="p-4 hidden md:table-cell text-gray-500">${c.email || '-'}</td>
                        <td class="p-4 text-center"><span class="bg-gray-100 px-2 py-1 rounded-full text-xs font-bold">${c.count}</span></td>
                        <td class="p-4 text-left text-sm text-gray-500">${Utils.formatDate(c.last).split(',')[0]}</td>
                    </tr>
                `).join('');
            }
        },

        openCustomer: (phone) => {
            const tickets = window.app.tickets.filter(t => t.customerPhone === phone).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
            if(tickets.length === 0) return;
            const latest = tickets[0];
            const customer = { name: latest.customerName, phone: latest.customerPhone, email: latest.customerEmail };
            window.app.currentCustomer = customer;

            const container = document.getElementById('view-customer-detail');
            container.innerHTML = `
                <div class="bg-white h-full flex flex-col rounded-lg shadow-lg overflow-hidden">
                     <div class="p-6 border-b flex justify-between items-start bg-gray-50">
                        <div>
                            <h2 class="text-2xl font-bold text-gray-800">${customer.name}</h2>
                            <div class="text-gray-600 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mt-2">
                                <span class="flex items-center gap-1"><i data-lucide="phone" class="w-4 text-blue-500"></i> ${customer.phone}</span>
                                ${customer.email ? `<span class="flex items-center gap-1"><i data-lucide="mail" class="w-4 text-blue-500"></i> ${customer.email}</span>` : ''}
                            </div>
                            <button onclick="window.app.openCreateTicket({name: '${customer.name}', phone: '${customer.phone}', email: '${customer.email || ''}'})" class="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 shadow-sm text-sm font-medium">
                                <i data-lucide="plus" class="w-4 h-4"></i> פתח תיקון חדש ללקוח זה
                            </button>
                        </div>
                        <button onclick="router.navigate('customers')" class="p-2 hover:bg-gray-200 rounded-full text-gray-500">
                            <i data-lucide="x"></i>
                        </button>
                     </div>
                     <div class="p-6 flex-1 overflow-y-auto bg-gray-50/50">
                        <div class="flex items-center gap-2 mb-4"><i data-lucide="file-text" class="w-5 text-gray-500"></i><h3 class="text-lg font-bold text-gray-700">היסטוריית תיקונים (${tickets.length})</h3></div>
                        <div class="space-y-3">
                            ${tickets.map(t => `
                                <div onclick="window.app.openTicket('${t.id}')" class="bg-white border p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center hover:shadow-md cursor-pointer transition gap-4">
                                    <div class="flex-1">
                                        <div class="flex items-center gap-2 mb-1"><span class="font-mono text-blue-600 font-bold">#${t.ticketNumber}</span><span class="font-medium text-gray-800">${t.bikeModel}</span></div>
                                        <div class="text-sm text-gray-600 line-clamp-1">${t.issueDescription}</div>
                                    </div>
                                    <div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                                        ${window.app.getStatusBadge(t.status)}
                                        <div class="text-xs text-gray-500 flex items-center gap-1"><i data-lucide="calendar" class="w-3"></i>${Utils.formatDate(t.createdAt).split(',')[0]}</div>
                                        <i data-lucide="chevron-left" class="w-4 text-gray-300"></i>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                     </div>
                </div>
            `;
            router.navigate('customer-detail');
            lucide.createIcons();
        },

        openTicket: (id) => {
            const ticket = window.app.tickets.find(t => t.id === id);
            if(!ticket) return;
            if (!ticket.quote) ticket.quote = { items: [], discount: 0, subtotal: 0, total: 0, signature: null, isSigned: false };
            window.app.currentTicket = ticket;
            window.app.isEditingDetails = false; 
            window.app.activeTicketTab = 'details'; 
            router.navigate('ticket-detail'); 
            window.app.renderTicketDetail(); 
        },

        switchTicketTab: (tabName) => { window.app.activeTicketTab = tabName; window.app.renderTicketDetail(); },
        toggleEditDetails: () => { window.app.isEditingDetails = !window.app.isEditingDetails; window.app.renderTicketDetail(); },
        
        saveTicketDetails: async () => {
             const container = document.getElementById('view-ticket-detail');
             const updates = {
                 customerName: container.querySelector('[data-field="customerName"]').value,
                 customerPhone: container.querySelector('[data-field="customerPhone"]').value,
                 customerEmail: container.querySelector('[data-field="customerEmail"]').value,
                 bikeModel: container.querySelector('[data-field="bikeModel"]').value,
                 issueDescription: container.querySelector('[data-field="issueDescription"]').value,
                 tagNumber: container.querySelector('[data-field="tagNumber"]').value
             };
             const newHistory = [...(window.app.currentTicket.history || []), { date: new Date().toISOString(), action: 'פרטים עודכנו', user: window.app.user ? window.app.user.email : 'צוות' }];
             await DB.update(window.app.currentTicket.id, { ...updates, history: newHistory });
             window.app.currentTicket = { ...window.app.currentTicket, ...updates, history: newHistory };
             window.app.isEditingDetails = false;
             window.app.renderTicketDetail();
             Utils.showToast("הפרטים עודכנו בהצלחה");
        },
        
        addTimelineEntry: async (e) => {
            e.preventDefault();
            const form = e.target;
            const newEntry = { id: crypto.randomUUID(), date: new Date().toISOString(), action: form.action.value, notes: form.notes.value, user: window.app.user ? window.app.user.email : 'טכנאי' };
            const updatedTimeline = [newEntry, ...(window.app.currentTicket.timeline || [])];
            await DB.update(window.app.currentTicket.id, { timeline: updatedTimeline });
            window.app.currentTicket.timeline = updatedTimeline;
            form.reset();
            window.app.renderTicketDetail();
        },

        archiveTicket: async () => {
            if (!window.app.currentTicket || !confirm("האם אתה בטוח שברצונך להעביר את התיקון לארכיון?")) return;
            try {
                await DB.update(window.app.currentTicket.id, { is_archived: true, status: 'archived' });
                const ticketIndex = window.app.tickets.findIndex(t => t.id === window.app.currentTicket.id);
                if (ticketIndex > -1) { window.app.tickets[ticketIndex].is_archived = true; window.app.tickets[ticketIndex].status = 'archived'; }
                window.app.currentTicket = null;
                Utils.showToast("התיקון הועבר לארכיון בהצלחה");
                router.navigate('tickets');
            } catch (e) { Utils.showToast("שגיאה בארכוב", "error"); }
        },

        deleteBike: () => {
            const id = document.getElementById('bike-form').querySelector('[name="id"]').value;
            if (id && confirm('האם למחוק אופניים אלו מהמלאי?')) {
                BikeDB.delete(id); window.app.bikes = BikeDB.getAll(); window.app.renderBikes();
                Utils.showToast('הפריט נמחק'); router.navigate('secondhand');
            }
        },

        renderBikes: () => {
            const search = document.getElementById('bike-search').value.toLowerCase();
            const brandFilter = document.getElementById('bike-filter-brand').value;
            const sizeFilter = document.getElementById('bike-filter-size').value;
            const filtered = window.app.bikes.filter(b => {
                return (b.brand + b.model + b.sku).toLowerCase().includes(search) && (brandFilter === 'all' || b.brand === brandFilter) && (sizeFilter === 'all' || b.size === sizeFilter);
            });
            const brandSelect = document.getElementById('bike-filter-brand'), sizeSelect = document.getElementById('bike-filter-size');
            if (brandSelect && brandSelect.children.length === 1) [...new Set(window.app.bikes.map(b => b.brand))].forEach(b => brandSelect.innerHTML += `<option value="${b}">${b}</option>`);
            if (sizeSelect && sizeSelect.children.length === 1) [...new Set(window.app.bikes.map(b => b.size))].forEach(s => sizeSelect.innerHTML += `<option value="${s}">${s}</option>`);
            const tbody = document.getElementById('bikes-table-body');
            if (filtered.length === 0) tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-gray-500">לא נמצאו אופניים</td></tr>`;
            else {
                tbody.innerHTML = filtered.map(b => `<tr class="hover:bg-blue-50 border-b border-gray-100 cursor-pointer" onclick="window.app.openBikeDetail('${b.id}')"><td class="p-4 font-medium">${b.brand}</td><td class="p-4">${b.model}</td><td class="p-4 hidden md:table-cell text-gray-500">${b.color || '-'}</td><td class="p-4">${b.size || '-'}</td><td class="p-4 font-bold text-green-600">${Utils.formatCurrency(b.price)}</td><td class="p-4"><i data-lucide="chevron-left" class="w-4 h-4 text-gray-400"></i></td></tr>`).join('');
                lucide.createIcons();
            }
        },

        openBikeDetail: (id) => {
            const bike = window.app.bikes.find(b => b.id === id); if (!bike) return;
            const form = document.getElementById('bike-form'); form.reset();
            Object.keys(bike).forEach(key => { const field = form.querySelector(`[name="${key}"]`); if(field) field.value = bike[key]; });
            form.querySelector('[name="id"]').value = bike.id;
            document.getElementById('bike-form-title').innerText = `עריכת אופניים: ${bike.brand} ${bike.model}`;
            document.getElementById('btn-delete-bike').classList.remove('hidden'); router.navigate('bike-detail');
        },

        openCreateBike: () => {
            const form = document.getElementById('bike-form'); form.reset(); form.querySelector('[name="id"]').value = '';
            document.getElementById('bike-form-title').innerText = 'כרטיס אופני יד שנייה - חדש';
            document.getElementById('btn-delete-bike').classList.add('hidden'); router.navigate('bike-detail');
        },

        renderTicketDetail: () => {
            const ticket = window.app.currentTicket;
            const customerHistory = window.app.tickets.filter(t => t.customerPhone === ticket.customerPhone && t.id !== ticket.id);
            const container = document.getElementById('view-ticket-detail');
            const timeline = ticket.timeline || [];
            const detailsContent = `<div class="flex justify-between items-center mb-4"><h3 class="text-lg font-bold">הצעת מחיר וטיפול</h3><div class="flex gap-2"><button onclick="window.app.printTicket()" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded flex items-center gap-1"><i data-lucide="printer" class="w-4"></i> הדפס</button><button onclick="window.app.saveQuote()" class="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded flex items-center gap-1"><i data-lucide="save" class="w-4"></i> שמור</button></div></div><div class="bg-white border rounded-lg overflow-hidden mb-6"><table class="w-full text-right text-sm" id="quote-table"><thead class="bg-gray-50 border-b"><tr><th class="p-3 w-10 text-center">בוצע</th><th class="p-3">תיאור</th><th class="p-3 w-20">כמות</th><th class="p-3 w-24">מחיר</th><th class="p-3 w-24">סה״כ</th><th class="p-3 w-10"></th></tr></thead><tbody id="quote-items-body"></tbody><tfoot class="bg-gray-50"><tr><td colspan="6" class="p-2 text-center"><button onclick="window.app.addQuoteItem()" class="text-blue-600 hover:underline"><i data-lucide="plus" class="w-3 inline"></i> הוסף שורה</button></td></tr></tfoot></table><div class="p-4 border-t bg-gray-50 flex justify-between items-center font-bold text-lg"><span>סה״כ לתשלום:</span><span id="quote-total">0.00 ₪</span></div></div>`;
            const timelineContent = `<div class="bg-white p-4 rounded-lg border mb-4"><h4 class="font-bold mb-3">הוסף תיעוד חדש</h4><form onsubmit="window.app.addTimelineEntry(event)" class="space-y-3"><div class="flex gap-2"><select name="action" class="border rounded p-2 text-sm w-1/3"><option>בדיקה ראשונית</option><option>המתנה לחלקים</option><option>ביצוע תיקון</option><option>בדיקת איכות</option><option>סיום טיפול</option><option>יצירת קשר עם לקוח</option></select><input name="notes" placeholder="פרט מה בוצע, תוצאות או הערות..." class="border rounded p-2 text-sm flex-1" required></div><div class="flex justify-end"><button type="submit" class="bg-blue-600 text-white px-4 py-1 rounded text-sm hover:bg-blue-700">הוסף ליומן</button></div></form></div><div class="relative border-r-2 border-gray-200 mr-3 space-y-6">${timeline.map((item, idx) => `<div class="timeline-item ${idx === 0 ? 'active' : ''} mr-6 relative"><div class="text-xs text-gray-500 mb-1 flex justify-between"><span>${Utils.formatDate(item.date)}</span><span class="font-bold">${item.user || 'מערכת'}</span></div><div class="bg-white p-3 rounded border shadow-sm"><div class="font-bold text-blue-700 text-sm mb-1">${item.action}</div><div class="text-sm text-gray-700">${item.notes}</div></div></div>`).join('')}${timeline.length === 0 ? '<div class="mr-6 text-gray-400 text-sm">אין רישומים ביומן עדיין.</div>' : ''}</div>`;
            const historyContent = `<div class="space-y-3 mt-4">${customerHistory.length === 0 ? '<div class="text-center text-gray-500 p-8">אין היסטוריה נוספת ללקוח זה</div>' : ''}${customerHistory.map(t => `<div onclick="window.app.openTicket('${t.id}')" class="bg-white border p-4 rounded-lg flex flex-col md:flex-row justify-between items-start md:items-center hover:shadow-md cursor-pointer transition gap-4"><div class="flex-1"><div class="flex items-center gap-2 mb-1"><span class="font-mono text-blue-600 font-bold">#${t.ticketNumber}</span><span class="font-medium text-gray-800">${t.bikeModel}</span></div><div class="text-sm text-gray-600 line-clamp-1">${t.issueDescription}</div></div><div class="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">${window.app.getStatusBadge(t.status)}<div class="text-xs text-gray-500 flex items-center gap-1"><i data-lucide="calendar" class="w-3"></i>${Utils.formatDate(t.createdAt).split(',')[0]}</div></div></div>`).join('')}</div>`;
            const renderInput = (field, value) => window.app.isEditingDetails ? `<input data-field="${field}" value="${value || ''}" class="w-full border rounded px-2 py-1 text-sm bg-white focus:ring-2 focus:ring-blue-200">` : `<div class="text-gray-800 font-medium">${value || '-'}</div>`;
            container.innerHTML = `<div class="bg-white h-full flex flex-col md:flex-row overflow-hidden rounded-lg shadow-lg"><div class="w-full md:w-1/3 bg-gray-50 border-l p-6 overflow-y-auto flex flex-col"><div class="flex justify-between items-start mb-6"><div><h2 class="text-2xl font-bold text-gray-800 flex items-center gap-2">תיקון #${ticket.ticketNumber}${ticket.tagNumber ? `<span class="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full border border-yellow-200">תג: ${ticket.tagNumber}</span>` : ''}</h2><div class="text-sm text-gray-500">${Utils.formatDate(ticket.createdAt)}</div></div><div class="flex gap-2"><button onclick="window.app.toggleEditDetails()" class="text-gray-500 hover:text-blue-600 p-1 rounded hover:bg-gray-200" title="${window.app.isEditingDetails ? 'בטל עריכה' : 'ערוך פרטים'}"><i data-lucide="${window.app.isEditingDetails ? 'x' : 'pencil'}" class="w-5 h-5"></i></button><button onclick="router.navigate('tickets')" class="text-gray-400 hover:text-gray-600"><i data-lucide="x"></i></button></div></div><div class="mb-6"><label class="block text-sm font-medium text-gray-500 mb-2">סטטוס</label><div class="flex flex-wrap gap-2">${Object.entries(STATUSES).map(([k, v]) => `<button onclick="window.app.updateStatus('${k}')" class="px-3 py-1 text-xs rounded-full border transition ${ticket.status === k ? v.color + ' ring-2 ring-blue-300' : 'bg-white text-gray-600'}">${v.label}</button>`).join('')}</div></div><div class="space-y-4 flex-1"><div class="bg-white p-4 rounded border relative group"><h3 class="font-semibold text-gray-700 flex items-center gap-2 mb-3"><i data-lucide="user" class="w-4"></i> פרטי לקוח</h3><div class="space-y-2 text-sm"><div><span class="text-gray-400 text-xs">שם:</span> ${renderInput('customerName', ticket.customerName)}</div><div><span class="text-gray-400 text-xs">טלפון:</span> ${renderInput('customerPhone', ticket.customerPhone)}</div><div><span class="text-gray-400 text-xs">אימייל:</span> ${renderInput('customerEmail', ticket.customerEmail)}</div></div></div><div class="bg-white p-4 rounded border mb-4"><h3 class="font-semibold text-gray-700 flex items-center gap-2 mb-3"><i data-lucide="tag" class="w-4"></i> מספר תג</h3><div class="space-y-2 text-sm">${renderInput('tagNumber', ticket.tagNumber)}</div></div><div class="bg-white p-4 rounded border"><h3 class="font-semibold text-gray-700 flex items-center gap-2 mb-3"><i data-lucide="wrench" class="w-4"></i> פרטי אופניים</h3><div class="space-y-2 text-sm"><div><span class="text-gray-400 text-xs">דגם:</span> ${renderInput('bikeModel', ticket.bikeModel)}</div><div><span class="text-gray-400 text-xs">תקלה:</span>${window.app.isEditingDetails ? `<textarea data-field="issueDescription" class="w-full border rounded px-2 py-1 text-sm h-20">${ticket.issueDescription}</textarea>` : `<div class="bg-gray-50 p-2 rounded text-gray-700 mt-1">${ticket.issueDescription}</div>`}</div></div></div>${window.app.isEditingDetails ? `<button onclick="window.app.saveTicketDetails()" class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 mt-4"><i data-lucide="save" class="w-4"></i> שמור שינויים</button>` : ''}<div class="mt-8 border-t pt-4"><button onclick="window.app.archiveTicket()" class="w-full flex items-center justify-center gap-2 p-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 transition-colors"><i data-lucide="archive" class="w-4 h-4"></i> העבר לארכיון</button></div></div></div><div class="w-full md:w-2/3 bg-white flex flex-col overflow-hidden"><div class="flex border-b bg-gray-50"><button onclick="window.app.switchTicketTab('details')" class="tab-btn flex-1 ${window.app.activeTicketTab === 'details' ? 'active' : ''}">הצעת מחיר וטיפול</button><button onclick="window.app.switchTicketTab('timeline')" class="tab-btn flex-1 ${window.app.activeTicketTab === 'timeline' ? 'active' : ''}">יומן טיפול (Story)</button><button onclick="window.app.switchTicketTab('history')" class="tab-btn flex-1 ${window.app.activeTicketTab === 'history' ? 'active' : ''}">היסטוריית לקוח</button></div><div class="p-6 overflow-y-auto h-full">${window.app.activeTicketTab === 'details' ? detailsContent : window.app.activeTicketTab === 'timeline' ? timelineContent : historyContent}</div></div></div>`;
            lucide.createIcons();
            if(window.app.activeTicketTab === 'details') { window.app.renderQuoteItems(); }
        },

        renderQuoteItems: () => {
            const tbody = document.getElementById('quote-items-body'); if(!tbody) return; 
            const items = window.app.currentTicket.quote.items || [];
            tbody.innerHTML = items.map((item, idx) => `<tr id="quote-row-${idx}"><td class="p-2 text-center"><input type="checkbox" class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer" ${item.completed ? 'checked' : ''} onchange="window.app.toggleQuoteItemCompletion(${idx})"></td><td class="p-2"><input class="w-full border rounded p-1" value="${item.description}" oninput="window.app.updateQuoteItem(${idx}, 'description', this.value)"></td><td class="p-2"><input type="number" class="w-full border rounded p-1" value="${item.quantity}" oninput="window.app.updateQuoteItem(${idx}, 'quantity', this.value)"></td><td class="p-2"><input type="number" class="w-full border rounded p-1" value="${item.price}" oninput="window.app.updateQuoteItem(${idx}, 'price', this.value)"></td><td class="p-2 row-total">${Utils.formatCurrency(item.quantity * item.price)}</td><td class="p-2 text-center"><button onclick="window.app.removeQuoteItem(${idx})" class="text-red-500"><i data-lucide="x" class="w-4"></i></button></td></tr>`).join('');
            window.app.updateQuoteTotal(); lucide.createIcons();
        },

        updateQuoteItem: (idx, field, val) => {
            const item = window.app.currentTicket.quote.items[idx]; item[field] = field === 'description' ? val : parseFloat(val) || 0;
            if (field !== 'description') { const row = document.getElementById(`quote-row-${idx}`); if(row) row.querySelector('.row-total').innerText = Utils.formatCurrency(item.quantity * item.price); }
            window.app.updateQuoteTotal();
        },

        toggleQuoteItemCompletion: (idx) => { const item = window.app.currentTicket.quote.items[idx]; item.completed = !item.completed; window.app.saveQuote(); },
        updateQuoteTotal: () => { const items = window.app.currentTicket.quote.items; const total = items.reduce((sum, i) => sum + (i.quantity * i.price), 0); window.app.currentTicket.quote.total = total; const totalEl = document.getElementById('quote-total'); if(totalEl) totalEl.innerText = Utils.formatCurrency(total); },
        addQuoteItem: () => { if(!window.app.currentTicket.quote.items) window.app.currentTicket.quote.items = []; window.app.currentTicket.quote.items.push({ description: '', quantity: 1, price: 0, completed: false }); window.app.renderQuoteItems(); },
        removeQuoteItem: (idx) => { window.app.currentTicket.quote.items.splice(idx, 1); window.app.renderQuoteItems(); },
        saveQuote: async () => { await DB.update(window.app.currentTicket.id, { quote: window.app.currentTicket.quote }); Utils.showToast('השינויים נשמרו'); },
        
        updateStatus: async (newStatus) => { 
            window.app.currentTicket.status = newStatus;
            // סנכרון דגל הארכיון אם הסטטוס נבחר ידנית כ'בארכיון'
            const isArchived = newStatus === 'archived';
            await DB.update(window.app.currentTicket.id, { 
                status: newStatus,
                is_archived: isArchived 
            }); 
            window.app.tickets = await DB.getAll(); 
            window.app.renderTicketDetail(); 
            Utils.showToast('סטטוס עודכן'); 
        },

        printTicket: () => {
            const ticket = window.app.currentTicket; const printWindow = window.open('', '_blank');
            const items = ticket.quote.items || []; const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.price), 0);
            const discount = ticket.quote.discount || 0; const total = subtotal - discount;
            const html = `<html dir="rtl"><head><title>הצעת מחיר - תיקון #${ticket.ticketNumber}</title><style>body { font-family: 'Heebo', sans-serif; padding: 40px; max-width: 800px; mx-auto; color: #333; }.header { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #eee; padding-bottom: 20px; margin-bottom: 30px; }.logo { font-size: 24px; font-weight: bold; color: #2563eb; }.meta { text-align: left; font-size: 14px; color: #666; }.title { font-size: 20px; font-weight: bold; margin-bottom: 20px; text-align: center; }.grid-container { display: flex; gap: 40px; margin-bottom: 30px; }.col { flex: 1; }.section-title { font-size: 16px; font-weight: bold; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 10px; color: #444; }.row { margin-bottom: 5px; font-size: 14px; }.label { font-weight: 500; color: #555; }table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }th { text-align: right; background: #f9fafb; padding: 10px; font-size: 14px; border-bottom: 1px solid #ddd; }td { padding: 10px; border-bottom: 1px solid #eee; font-size: 14px; }.totals { margin-top: 0; margin-left: 0; margin-right: auto; width: 300px; }.total-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }.grand-total { font-weight: bold; font-size: 18px; border-top: 2px solid #333; margin-top: 10px; padding-top: 10px; }.footer { margin-top: 50px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 20px; }@media print { body { padding: 0; } button { display: none; } }</style></head><body><div class="header"><div class="logo">BikeCare Workshop CRM</div><div class="meta"><div>תאריך: ${new Date().toLocaleDateString('he-IL')}</div><div>מספר תיקון: #${ticket.ticketNumber}</div></div></div><div class="title">הצעת מחיר / כרטיס עבודה</div><div class="grid-container"><div class="col"><div class="section-title">פרטי לקוח</div><div class="row"><span class="label">שם:</span> ${ticket.customerName}</div><div class="row"><span class="label">טלפון:</span> ${ticket.customerPhone}</div><div class="row"><span class="label">אימייל:</span> ${ticket.customerEmail || '-'}</div></div><div class="col"><div class="section-title">פרטי אופניים</div><div class="row"><span class="label">דגם:</span> ${ticket.bikeModel}</div><div class="row"><span class="label">תקלה:</span> ${ticket.issueDescription}</div>${ticket.tagNumber ? `<div class="row"><span class="label">מספר תג:</span> ${ticket.tagNumber}</div>` : ''}</div></div><table><thead><tr><th>תיאור</th><th style="width: 60px">כמות</th><th style="width: 100px">מחיר יח׳</th><th style="width: 100px">סה״כ</th></tr></thead><tbody>${items.map(item => `<tr><td>${item.description}</td><td>${item.quantity}</td><td>${Utils.formatCurrency(item.price)}</td><td>${Utils.formatCurrency(item.quantity * item.price)}</td></tr>`).join('')}</tbody></table><div class="totals"><div class="total-row"><span>סכום ביניים:</span><span>${Utils.formatCurrency(subtotal)}</span></div><div class="total-row"><span>הנחה:</span><span>${Utils.formatCurrency(discount)}</span></div><div class="total-row grand-total"><span>סה״כ לתשלום:</span><span>${Utils.formatCurrency(total)}</span></div></div><div class="footer">הופק על ידי מערכת BikeCare Workshop CRM</div><script>window.onload = function() { window.print(); }<\/script></body></html>`;
            printWindow.document.write(html); printWindow.document.close();
        },

        getStatusBadge: (status, textOnly = false) => {
            const s = STATUSES[status] || STATUSES.new;
            if(textOnly) return s.label; return `<span class="px-2 py-1 rounded-full text-xs font-medium ${s.color}">${s.label}</span>`;
        },
        getPriorityLabel: (p) => (PRIORITIES[p] || PRIORITIES.normal).label
    };

    const STATUSES = {
        new: { label: 'חדש', color: 'bg-blue-100 text-blue-800' },
        new_bike: { label: 'אופניים חדשים', color: 'bg-teal-100 text-teal-800' },
        test_bike: { label: 'אופני מבחן', color: 'bg-orange-100 text-orange-800' },
        in_progress: { label: 'בטיפול', color: 'bg-yellow-100 text-yellow-800' },
        waiting_approval: { label: 'ממתין לאישור', color: 'bg-purple-100 text-purple-800' },
        completed: { label: 'הושלם', color: 'bg-green-100 text-green-800' },
        cancelled: { label: 'בוטל', color: 'bg-gray-100 text-gray-800' },
        archived: { label: 'בארכיון', color: 'bg-gray-200 text-gray-600' }
    };
    const PRIORITIES = {
        normal: { label: 'רגיל' },
        high: { label: 'גבוה' },
        urgent: { label: 'דחוף' }
    };

    const closeMobileMenu = () => {
        const aside = document.querySelector('aside');
        if (aside.classList.contains('absolute')) {
            aside.classList.add('hidden');
            aside.classList.remove('absolute', 'z-50', 'h-full');
        }
    };

// --- Router ---
const router = {
  navigate: (target) => {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${target}`).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if(btn.dataset.target === target) btn.classList.add('bg-blue-50', 'text-blue-700');
      else btn.classList.remove('bg-blue-50', 'text-blue-700');
    });
    if(target === 'dashboard') window.app.renderDashboard();
    if(target === 'tickets') window.app.renderTickets();
    if(target === 'customers') window.app.renderCustomers();
    if(target === 'secondhand') window.app.renderBikes();
    if(target === 'archive') window.app.renderArchive();
    closeMobileMenu();
  }
};

window.router = router;

// Init with DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => window.app.init());
