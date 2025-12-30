README.md – גרסה מתוקנת
# BikeCare Workshop CRM

CRM ייעודי לניהול מוסך אופניים.  
המערכת מאפשרת ניהול קריאות שירות, לקוחות ואופניים, עם התחברות באמצעות Supabase (כולל Google OAuth).

---

## Tech Stack
- Vite
- Vanilla JavaScript
- Supabase (Auth + Database)
- Vercel (Deployment)

---

## הרצה מקומית (Local Development)

### דרישות מוקדמות
- Node.js (גרסה מומלצת: 18+)
- npm

### התקנה
```bash
npm install

משתני סביבה

יש ליצור קובץ .env בשורש הפרויקט עם המשתנים הבאים:

VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>


שימו לב:

אין להעלות את הקובץ .env ל-GitHub

חובה להפעיל מחדש את השרת לאחר שינוי ב-ENV

הרצה
npm run dev


האפליקציה תהיה זמינה ב:

http://localhost:5173

Build ו-Preview
npm run build
npm run preview

Deployment (Vercel)

הפרויקט מחובר ל-GitHub

Branch main הוא Production

כל push ל-main מפעיל Deploy אוטומטי

משתני הסביבה מוגדרים ב-Vercel תחת:
Project Settings → Environment Variables