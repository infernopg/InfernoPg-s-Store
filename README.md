# Inferno's Store

A premium black/maroon game download store with:
- Public game catalog
- Search and genre filtering
- Game details pages
- Download tracking
- 1–5 star reviews
- Owner-only admin login
- Admin game publishing/deletion
- SQLite database
- Upload support for thumbnails and game files

## Run locally

1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run:
   npm install
4. Start:
   npm start
5. Open:
   http://localhost:3000

## Admin

For local development, the default credentials are:
- Username: `admin`
- Password: `ChangeMe123!`

For production, ALWAYS set:
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Example:
ADMIN_USERNAME=yourname ADMIN_PASSWORD=your-strong-password SESSION_SECRET=long-random-secret npm start

## Important production note

The demo games use placeholder download URLs (`example.com`). Replace them in the admin workflow or database with your real files/URLs.

For public hosting, use HTTPS, a strong session secret, a persistent database/storage setup, and a proper domain. Do not use the default admin password.
