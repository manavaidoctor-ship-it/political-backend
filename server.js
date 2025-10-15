require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
app.use(
  cors({
    origin: [
      "https://political-frontend.onrender.com",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ============================================================
// ✅ DATABASE CONNECTION
// ============================================================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ============================================================
// ✅ VOTER LIST
// ============================================================
app.get("/api/voters", async (req, res) => {
  try {
    let { search = "", booth = "", page = 1, limit = 100 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    if (search) {
      where.push(`
        (LOWER(name) LIKE LOWER(?) 
        OR LOWER(epic_no) LIKE LOWER(?) 
        OR LOWER(house_no) LIKE LOWER(?) 
        OR LOWER(relative_name) LIKE LOWER(?) 
        OR LOWER(tamil_name) LIKE LOWER(?) 
        OR LOWER(tamil_relative_name) LIKE LOWER(?))
      `);
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    if (booth) {
      where.push("booth_no = ?");
      params.push(booth);
    }

    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";
    const [rows] = await pool.query(
      `SELECT * FROM voters ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total FROM voters ${whereClause}`,
      params
    );

    res.json({ data: rows, total: countResult[0].total });
  } catch (err) {
    console.error("Error fetching voters:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ✅ UPDATE MOBILE NUMBER
// ============================================================
app.put("/api/voters/:id/mobile", async (req, res) => {
  try {
    const { id } = req.params;
    const { mobile_number } = req.body;

    if (!mobile_number)
      return res.status(400).json({ error: "Mobile number required" });

    await pool.query("UPDATE voters SET mobile_number = ? WHERE id = ?", [
      mobile_number,
      id,
    ]);

    res.json({ message: "✅ Mobile number updated successfully!" });
  } catch (err) {
    console.error("Error updating mobile:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ✅ SUMMARY
// ============================================================
app.get("/api/summary", async (req, res) => {
  try {
    const [genderRows] = await pool.query(
      "SELECT gender, COUNT(*) AS count FROM voters GROUP BY gender"
    );
    const [ageRows] = await pool.query(`
      SELECT 
        SUM(CASE WHEN age BETWEEN 18 AND 25 THEN 1 ELSE 0 END) AS age_18_25,
        SUM(CASE WHEN age BETWEEN 26 AND 50 THEN 1 ELSE 0 END) AS age_26_50,
        SUM(CASE WHEN age BETWEEN 51 AND 75 THEN 1 ELSE 0 END) AS age_51_75,
        SUM(CASE WHEN age > 75 THEN 1 ELSE 0 END) AS age_75_plus
      FROM voters
    `);
    res.json({ gender: genderRows, ageGroups: ageRows[0] });
  } catch (err) {
    console.error("Error fetching summary:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ✅ EVENTS (Add / Fetch / Delete / View All)
// ============================================================

// ➕ Add Event
app.post("/api/events", async (req, res) => {
  try {
    const { name, native_place, mobile, panchayat, event_date, description } =
      req.body;
    if (!name || !event_date)
      return res
        .status(400)
        .json({ error: "Name and Event Date are required" });

    await pool.query(
      "INSERT INTO events (name, native_place, mobile, panchayat, event_date, description) VALUES (?, ?, ?, ?, ?, ?)",
      [name, native_place, mobile, panchayat, event_date, description]
    );

    res.json({ message: "✅ Event added successfully!" });
  } catch (err) {
    console.error("Error adding event:", err);
    res.status(500).json({ error: err.message });
  }
});

// 📅 Fetch Today & Tomorrow Events
app.get("/api/events/today", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, native_place, mobile, panchayat, event_date, description
      FROM events
      WHERE event_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      ORDER BY event_date ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: err.message });
  }
});
// ✅ GET ALL EVENTS
app.get("/api/events/all", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, native_place, mobile, panchayat, event_date, description
      FROM events
      ORDER BY event_date DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching all events:", err);
    res.status(500).json({ error: err.message });
  }
});


// ❌ Delete Event
app.delete("/api/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM events WHERE id = ?", [id]);
    res.json({ message: "🗑️ Event deleted successfully!" });
  } catch (err) {
    console.error("Error deleting event:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ✅ IMPORTANT FILES
// ============================================================
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const originalName = path.basename(file.originalname).trim().replace(/\s+/g, "_");
    let counter = 1;
    let finalName = originalName;

    while (fs.existsSync(path.join(uploadFolder, finalName))) {
      const name = path.parse(originalName).name;
      const ext = path.extname(originalName);
      finalName = `${name}(${counter})${ext}`;
      counter++;
    }

    cb(null, finalName);
  },
});

const upload = multer({ storage });

app.post("/api/important/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fileUrl = `http://localhost:4000/uploads/${req.file.filename}`;
  res.json({
    message: "✅ File uploaded successfully!",
    name: req.file.filename,
    url: fileUrl,
  });
});

app.get("/api/important/list", (req, res) => {
  try {
    const files = fs.readdirSync(uploadFolder).map((file) => {
      const stats = fs.statSync(path.join(uploadFolder, file));
      return {
        name: file,
        size: (stats.size / 1024).toFixed(1) + " KB",
        date: stats.mtime.toLocaleDateString("en-IN"),
        url: `http://localhost:4000/uploads/${file}`,
      };
    });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/important/delete/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(uploadFolder, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ message: `🗑️ File '${filename}' deleted successfully!` });
    } else return res.status(404).json({ error: "File not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use("/uploads", express.static(uploadFolder));

// ============================================================
// ✅ VISITORS MANAGEMENT
// ============================================================
app.post("/api/visitors", async (req, res) => {
  try {
    const { name, native_place, village, mobile } = req.body;
    if (!name || !mobile)
      return res.status(400).json({ error: "Name and Mobile required" });

    await pool.query(
      "INSERT INTO visitors (name, native_place, village, mobile, visit_date) VALUES (?, ?, ?, ?, NOW())",
      [name, native_place, village, mobile]
    );

    const [visitors] = await pool.query("SELECT * FROM visitors ORDER BY visit_date DESC");
    const ws = XLSX.utils.json_to_sheet(visitors);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Visitors");
    XLSX.writeFile(wb, path.join(uploadFolder, "visitors.xlsx"));

    res.json({ message: "✅ Visitor added successfully!" });
  } catch (err) {
    console.error("Error adding visitor:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/visitors", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM visitors ORDER BY visit_date DESC");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching visitors:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/visitors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM visitors WHERE id = ?", [id]);

    const [visitors] = await pool.query("SELECT * FROM visitors ORDER BY visit_date DESC");
    const ws = XLSX.utils.json_to_sheet(visitors);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Visitors");
    XLSX.writeFile(wb, path.join(uploadFolder, "visitors.xlsx"));

    res.json({ message: "🗑️ Visitor deleted successfully!" });
  } catch (err) {
    console.error("Error deleting visitor:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// ✅ USER LOGIN AUTHENTICATION
// ============================================================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username = ? AND password = ?",
      [username, password]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    res.json({
      message: "✅ Login successful!",
      user: {
        id: rows[0].id,
        username: rows[0].username,
        role: rows[0].role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// ✅ Wish Message - Upload Image
// ============================================================
app.post("/api/wish/upload", upload.single("image"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "No image uploaded" });

  // Use your live backend domain instead of localhost
  const fileUrl = `https://political-backend.onrender.com/uploads/${req.file.filename}`;
  res.json({ imageUrl: fileUrl });
});

// ============================================================
// ✅ Fetch recipients (all voters with valid mobile numbers)
// ============================================================
app.get("/api/wish/recipients", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT mobile_number FROM voters WHERE mobile_number IS NOT NULL AND mobile_number != ''"
    );
    res.json({ phones: rows.map((r) => r.mobile_number) });
  } catch (err) {
    console.error("Error fetching recipients:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ✅ Wish Message - Send Message
// ============================================================
app.post("/api/wish/send", async (req, res) => {
  const { recipients, message, imageUrl, sentBy } = req.body;
  if (!recipients || !message)
    return res.status(400).json({ error: "Recipients and message required" });

  try {
    const results = [];
    for (const phone of recipients) {
      try {
        await pool.query(
          "INSERT INTO message_log (phone, message, image_url, source, status, sent_by) VALUES (?, ?, ?, 'wish_portal', 'logged', ?)",
          [phone, message, imageUrl || null, sentBy || "System"]
        );
        results.push({ phone, status: "logged" });
      } catch (err) {
        results.push({ phone, status: "failed", error: err.message });
      }
    }

    res.json({
      message: "✅ Messages logged successfully!",
      total: recipients.length,
      results,
    });
  } catch (error) {
    console.error("Error sending messages:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ✅ START SERVER (Render-compatible)
// ============================================================
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
  res.send("✅ Political Backend is Live on Render!");
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

