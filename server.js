const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(PUBLIC, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const db = new Database(path.join(DATA, "store.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  genre TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  file_size TEXT DEFAULT 'Unknown',
  release_date TEXT DEFAULT CURRENT_DATE,
  thumbnail TEXT NOT NULL,
  download_url TEXT NOT NULL,
  rating REAL DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  review TEXT DEFAULT '',
  fingerprint TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
);
`);

function hash(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

const admin = db.prepare("SELECT id FROM admins LIMIT 1").get();
if (!admin) {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username, hash(password));
  console.log(`Admin created: ${username}. Set ADMIN_USERNAME/ADMIN_PASSWORD in production.`);
}

const seed = db.prepare("SELECT COUNT(*) AS n FROM games").get().n;
if (!seed) {
  const demo = [
    ["Inferno Survival","inferno-survival","Survival","Survive dangerous environments, collect resources and overcome challenging situations.","1.0.0","850 MB","2026-09-01","/uploads/inferno-survival.svg","https://example.com/download/inferno-survival"],
    ["Red Zone","red-zone","Action","Enter a dangerous combat zone and complete challenging missions.","1.2.0","1.4 GB","2026-09-10","/uploads/red-zone.svg","https://example.com/download/red-zone"],
    ["Dark Quest","dark-quest","Adventure","Explore a mysterious world, discover secrets and complete difficult challenges.","1.0.4","1.1 GB","2026-09-20","/uploads/dark-quest.svg","https://example.com/download/dark-quest"]
  ];
  const stmt = db.prepare(`INSERT INTO games(name,slug,genre,description,version,file_size,release_date,thumbnail,download_url)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  demo.forEach(g => stmt.run(...g));
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-session-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000*60*60*8 }
}));
app.use(express.static(PUBLIC));

function auth(req,res,next) {
  if (!req.session.adminId) return res.status(401).json({error:"Unauthorized"});
  next();
}

const storage = multer.diskStorage({
  destination: (_req,_file,cb) => cb(null, UPLOADS),
  filename: (_req,file,cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req,file,cb) => {
    const allowed = /\.(png|jpe?g|webp|gif|svg|zip|rar|7z|apk|exe|msi)$/i.test(file.originalname);
    cb(allowed ? null : new Error("Unsupported file type"), allowed);
  }
});

app.get("/api/games", (_req,res) => {
  const games = db.prepare(`
    SELECT g.*, COALESCE(ROUND(AVG(r.rating),1),g.rating,0) AS live_rating,
           COUNT(r.id) AS rating_count
    FROM games g LEFT JOIN reviews r ON r.game_id=g.id
    GROUP BY g.id ORDER BY g.created_at DESC
  `).all();
  res.json(games);
});

app.get("/api/games/:slug", (req,res) => {
  const game = db.prepare(`
    SELECT g.*, COALESCE(ROUND(AVG(r.rating),1),g.rating,0) AS live_rating,
           COUNT(r.id) AS rating_count
    FROM games g LEFT JOIN reviews r ON r.game_id=g.id
    WHERE g.slug=? GROUP BY g.id
  `).get(req.params.slug);
  if (!game) return res.status(404).json({error:"Game not found"});
  const reviews = db.prepare("SELECT rating,review,created_at FROM reviews WHERE game_id=? ORDER BY created_at DESC LIMIT 20").all(game.id);
  res.json({...game,reviews});
});

app.post("/api/games/:id/download", (req,res) => {
  const game = db.prepare("SELECT id,download_url FROM games WHERE id=?").get(req.params.id);
  if (!game) return res.status(404).json({error:"Game not found"});
  db.prepare("UPDATE games SET downloads=downloads+1 WHERE id=?").run(game.id);
  res.json({url:game.download_url});
});

app.post("/api/games/:id/reviews", (req,res) => {
  const game = db.prepare("SELECT id FROM games WHERE id=?").get(req.params.id);
  if (!game) return res.status(404).json({error:"Game not found"});
  const rating = Number(req.body.rating);
  const review = String(req.body.review || "").trim().slice(0,300);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({error:"Rating must be 1-5"});
  const fp = crypto.createHash("sha256").update((req.ip || "") + "|" + (req.get("user-agent") || "")).digest("hex");
  const recent = db.prepare("SELECT id FROM reviews WHERE game_id=? AND fingerprint=? AND created_at > datetime('now','-24 hours')").get(game.id,fp);
  if (recent) return res.status(429).json({error:"You already rated this game recently."});
  db.prepare("INSERT INTO reviews(game_id,rating,review,fingerprint) VALUES(?,?,?,?)").run(game.id,rating,review,fp);
  res.json({ok:true});
});

app.post("/api/admin/login", (req,res) => {
  const {username,password} = req.body;
  const row = db.prepare("SELECT id,password_hash FROM admins WHERE username=?").get(username);
  if (!row || row.password_hash !== hash(String(password || ""))) return res.status(401).json({error:"Invalid credentials"});
  req.session.adminId = row.id;
  res.json({ok:true});
});
app.post("/api/admin/logout", (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get("/api/admin/me", auth, (_req,res) => res.json({ok:true}));

app.post("/api/admin/games", auth, upload.fields([{name:"thumbnail",maxCount:1},{name:"gameFile",maxCount:1}]), (req,res) => {
  try {
    const {name,genre,description,version,file_size,release_date,download_url} = req.body;
    if (!name || !genre || !description) return res.status(400).json({error:"Name, genre and description are required"});
    const thumb = req.files?.thumbnail?.[0] ? "/uploads/" + req.files.thumbnail[0].filename : "/uploads/default.svg";
    const file = req.files?.gameFile?.[0] ? "/uploads/" + req.files.gameFile[0].filename : download_url;
    if (!file) return res.status(400).json({error:"Provide a download URL or upload a game file"});
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") + "-" + Date.now();
    db.prepare(`INSERT INTO games(name,slug,genre,description,version,file_size,release_date,thumbnail,download_url)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(name,slug,genre,description,version||"1.0.0",file_size||"Unknown",release_date||new Date().toISOString().slice(0,10),thumb,file);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.delete("/api/admin/games/:id", auth, (req,res) => {
  const game = db.prepare("SELECT thumbnail,download_url FROM games WHERE id=?").get(req.params.id);
  if (!game) return res.status(404).json({error:"Not found"});
  db.prepare("DELETE FROM games WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("*", (_req,res) => res.sendFile(path.join(PUBLIC,"index.html")));
app.use((err,_req,res,_next) => res.status(400).json({error:err.message}));

app.listen(PORT, () => console.log(`Inferno's Store running on http://localhost:${PORT}`));
