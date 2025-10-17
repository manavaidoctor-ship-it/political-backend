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
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  ssl: { rejectUnauthorized: false },
});
pool.on("error", (err) => {
  console.error("MySQL Pool Error:", err.code);
  if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
    console.log("⚠️ Reconnecting to MySQL...");
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
// ✅ Dynamic Summary API (Booth / Panchayat / Village Filter)
app.get("/api/summary", async (req, res) => {
  try {
    const { booth_no, panchayat_id, village_name } = req.query;
    let where = "WHERE 1=1";
    const params = [];

    if (booth_no) {
      where += " AND booth_no = ?";
      params.push(booth_no);
    }
    if (panchayat_id) {
      where += " AND panchayat_id = ?";
      params.push(panchayat_id);
    }
    if (village_name) {
      where += " AND village_name = ?";
      params.push(village_name);
    }

    const [genderRows] = await pool.query(
      `SELECT gender, COUNT(*) AS count FROM voters ${where} GROUP BY gender`,
      params
    );

    const [ageRows] = await pool.query(
      `
      SELECT 
        SUM(CASE WHEN age BETWEEN 18 AND 25 THEN 1 ELSE 0 END) AS age_18_25,
        SUM(CASE WHEN age BETWEEN 26 AND 50 THEN 1 ELSE 0 END) AS age_26_50,
        SUM(CASE WHEN age BETWEEN 51 AND 75 THEN 1 ELSE 0 END) AS age_51_75,
        SUM(CASE WHEN age > 75 THEN 1 ELSE 0 END) AS age_75_plus
      FROM voters
      ${where}
      `,
      params
    );

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
// ✅ IMPORTANT FILES — UPDATED VERSION (Live Compatible)
// ============================================================
const uploadFolder = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

// ✅ Configure multer for safe uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname
      .replace(/\s+/g, "_")
      .replace(/[^\w.\-]/g, "");
    cb(null, `${timestamp}_${safeName}`);
  },
});

// ✅ File format filter (allow PDF, Excel, Image)
const allowedTypes = [
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/jpg",
];

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error("❌ Invalid file type — only PDF, Excel, or images allowed."));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // ✅ max 10 MB
});

// ✅ Upload endpoint
app.post("/api/important/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const backendUrl =
      process.env.BACKEND_URL || "http://localhost:4000"; // Works live too
    const fileUrl = `${backendUrl}/uploads/${req.file.filename}`;

    res.json({
      message: "✅ File uploaded successfully!",
      name: req.file.filename,
      url: fileUrl,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "File upload failed" });
  }
});

// ✅ Fetch all uploaded files
app.get("/api/important/list", (req, res) => {
  try {
    const backendUrl =
      process.env.BACKEND_URL || "http://localhost:4000";

    const files = fs.readdirSync(uploadFolder).map((file) => {
      const stats = fs.statSync(path.join(uploadFolder, file));
      return {
        name: file,
        size: (stats.size / 1024).toFixed(1) + " KB",
        date: stats.mtime.toLocaleString("en-IN"),
        url: `${backendUrl}/uploads/${file}`,
      };
    });
    res.json(files);
  } catch (err) {
    console.error("Error reading uploads folder:", err);
    res.status(500).json({ error: "Unable to fetch uploaded files" });
  }
});

// ✅ Delete a file safely
app.delete("/api/important/delete/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(uploadFolder, filename);

    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "File not found" });

    fs.unlinkSync(filePath);
    res.json({ message: `🗑️ File '${filename}' deleted successfully!` });
  } catch (err) {
    console.error("Delete file error:", err);
    res.status(500).json({ error: "Unable to delete file" });
  }
});

// ✅ Serve uploaded files
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
// ✅ PANCHAYAT / BOOTH / VILLAGE / CASTE / FAMILY APIs (FINAL VERSION)
// ============================================================

// 1️⃣ Add Panchayat
app.post("/api/panchayat", async (req, res) => {
  try {
    const { panchayat_name } = req.body;
    if (!panchayat_name)
      return res.status(400).json({ error: "Panchayat name required" });

    await pool.query(
      "INSERT IGNORE INTO panchayat_master (panchayat_name) VALUES (?)",
      [panchayat_name]
    );
    res.json({ message: "✅ Panchayat created!" });
  } catch (err) {
    console.error("Error adding panchayat:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get All Panchayats
app.get("/api/panchayats", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT panchayat_id, panchayat_name FROM panchayat_master ORDER BY panchayat_name"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching panchayats:", err);
    res.status(500).json({ error: "Failed to fetch panchayats" });
  }
});

// 2️⃣ Add Booth
app.post("/api/booth", async (req, res) => {
  try {
    const { booth_no, panchayat_id, total_villages } = req.body;
    if (!booth_no)
      return res.status(400).json({ error: "Booth number required" });

    await pool.query(
      "INSERT IGNORE INTO booth_master (booth_no, panchayat_id, total_villages) VALUES (?, ?, ?)",
      [booth_no, panchayat_id || null, total_villages || 0]
    );
    res.json({ message: "✅ Booth added successfully!" });
  } catch (err) {
    console.error("Error adding booth:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get All Booths (for dropdown / filter)
app.get("/api/booths", async (req, res) => {
  try {
    const { panchayat_id } = req.query;
    let sql = `
      SELECT booth_id, booth_no, panchayat_id, total_villages
      FROM booth_master
      WHERE 1=1
    `;
    const params = [];

    if (panchayat_id) {
      sql += " AND panchayat_id = ?";
      params.push(panchayat_id);
    }

    sql += " ORDER BY booth_no ASC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching booths:", err);
    res.status(500).json({ error: "Failed to fetch booths" });
  }
});

// 3️⃣ Add Village
app.post("/api/village", async (req, res) => {
  try {
    const { booth_no, village_name } = req.body;
    if (!booth_no || !village_name)
      return res
        .status(400)
        .json({ error: "Booth No & Village Name required" });

    await pool.query(
      "INSERT IGNORE INTO village_master (booth_no, village_name) VALUES (?, ?)",
      [booth_no, village_name]
    );
    res.json({ message: "✅ Village added successfully!" });
  } catch (err) {
    console.error("Error adding village:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get Villages by Booth
app.get("/api/villages", async (req, res) => {
  try {
    const { booth_no } = req.query;
    if (!booth_no)
      return res.status(400).json({ error: "Booth number required" });

    const [rows] = await pool.query(
      "SELECT village_id, village_name, booth_no FROM village_master WHERE booth_no = ? ORDER BY village_name",
      [booth_no]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching villages:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4️⃣ Add Caste
app.post("/api/caste", async (req, res) => {
  try {
    const { caste_name, caste_code } = req.body;
    if (!caste_name)
      return res.status(400).json({ error: "Caste name required" });

    await pool.query(
      "INSERT IGNORE INTO caste_master (caste_name, caste_code) VALUES (?, ?)",
      [caste_name, caste_code || null]
    );
    res.json({ message: "✅ Caste added!" });
  } catch (err) {
    console.error("Error adding caste:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get All Castes
app.get("/api/castes", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT caste_id, caste_name, caste_code FROM caste_master ORDER BY caste_name"
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching castes:", err);
    res.status(500).json({ error: "Failed to fetch castes" });
  }
});

/// ============================================================
// ✅ FINAL FIXED GET VOTERS (Search + Pagination + 200 Per Page)
// ============================================================
app.get("/api/voters", async (req, res) => {
  try {
    let { search = "", booth_no = "", page = 1, limit = 200 } = req.query; // 👈 limit = 200 per page
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    if (!booth_no)
      return res.status(400).json({ error: "Booth number required" });

    // 👇 Only fetch unlinked voters (is_linked = 0)
    const where = ["booth_no = ?", "is_linked = 0"];
    const params = [booth_no];


    // ✅ Optional Search Filter
    if (search) {
      where.push(`
        (LOWER(name) LIKE LOWER(?) 
        OR LOWER(epic_no) LIKE LOWER(?) 
        OR LOWER(relative_name) LIKE LOWER(?)
        OR LOWER(tamil_name) LIKE LOWER(?)
        OR LOWER(tamil_relative_name) LIKE LOWER(?))
      `);
      params.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    }

    const whereClause = "WHERE " + where.join(" AND ");

    // ✅ Fetch voters for this booth + pagination
    const [rows] = await pool.query(
      `SELECT id, epic_no, name, relative_name, age, gender, mobile_number,
              village_name, panchayat_id, caste_code, booth_no
       FROM voters
       ${whereClause}
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // ✅ Get total count (for frontend page calculation)
    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total FROM voters ${whereClause}`,
      params
    );

    // ✅ Ensure total is integer
    const total = parseInt(countResult[0].total, 10);
    const total_pages = Math.ceil(total / limit);

    // 🔥 Force correct booth number for frontend
    const corrected = rows.map((v) => ({
      ...v,
      booth_no: Number(booth_no),
    }));

    // ✅ Send clean paginated response
    res.json({
      data: corrected,
      total,
      page,
      per_page: limit,
      total_pages,
    });
  } catch (err) {
    console.error("Error fetching voters:", err);
    res.status(500).json({ error: err.message });
  }
});


// ✅ Create Family (auto update voter info & hide linked voters)
app.post("/api/family", async (req, res) => {
  const {
    booth_no,
    village_name,
    family_name,
    contact_no,
    caste_code,
    party_support,
    panchayat_id,
    selected_voters,
  } = req.body;

  if (!booth_no || !family_name || !selected_voters?.length)
    return res.status(400).json({ error: "Missing required data" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 🧠 Prevent duplicate family name within same booth
    const [exists] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM family_master WHERE booth_no = ? AND family_name = ?",
      [booth_no, family_name]
    );
    if (exists[0].cnt > 0) {
      await conn.rollback();
      return res.status(400).json({ error: "⚠️ Family name already exists in this booth!" });
    }

    // ✅ Insert into family_master
    const [familyResult] = await conn.query(
      `INSERT INTO family_master 
       (booth_no, village_name, family_name, contact_no, caste_code, party_support)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [booth_no, village_name, family_name, contact_no, caste_code, party_support || "OTHERS"]
    );
    const family_id = familyResult.insertId;

    // ✅ Insert each member and mark voters as linked properly
    for (const voter of selected_voters) {
      const voterId = parseInt(voter.voter_id, 10);

      await conn.query(
        `INSERT INTO family_members 
         (family_id, voter_id, voter_name, age, gender)
         VALUES (?, ?, ?, ?, ?)`,
        [family_id, voterId, voter.voter_name, voter.age, voter.gender]
      );

      const [updateResult] = await conn.query(
        `UPDATE voters 
         SET is_linked = 1,
             caste_code = ?,
             village_name = ?,
             panchayat_id = ?,
             linked_mobile = ?
         WHERE id = ?`,
        [caste_code, village_name, panchayat_id || null, contact_no, voterId]
      );

      if (updateResult.affectedRows === 0) {
        console.warn(`⚠️ No voter updated for id: ${voterId}`);
      }
    }

    await conn.commit();
    res.json({ message: "✅ Family created successfully!", family_id });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Error creating family:", err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});


// 7️⃣ Get Family List (with member count)
app.get("/api/families", async (req, res) => {
  try {
    const { panchayat_id, booth_no, village_name } = req.query;
    let sql = `
      SELECT 
        f.family_id, f.family_name, f.contact_no, f.party_support,
        f.village_name, f.booth_no, c.caste_name, p.panchayat_name,
        COUNT(m.voter_id) AS member_count
      FROM family_master f
      LEFT JOIN family_members m ON f.family_id = m.family_id
      LEFT JOIN caste_master c ON f.caste_code = c.caste_code
      LEFT JOIN booth_master b ON f.booth_no = b.booth_no
      LEFT JOIN panchayat_master p ON b.panchayat_id = p.panchayat_id
      WHERE 1=1
    `;

    const params = [];
    if (panchayat_id) {
      sql += " AND p.panchayat_id = ?";
      params.push(panchayat_id);
    }
    if (booth_no) {
      sql += " AND f.booth_no = ?";
      params.push(booth_no);
    }
    if (village_name) {
      sql += " AND f.village_name = ?";
      params.push(village_name);
    }

    sql += " GROUP BY f.family_id ORDER BY f.family_name ASC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching families:", err);
    res.status(500).json({ message: "Error fetching families" });
  }
});

// ✅ Get Members of a Family — FINAL FIXED VERSION
app.get("/api/family/:id/members", async (req, res) => {
  try {
    const familyId = req.params.id;

    const [rows] = await pool.query(
      `
      SELECT 
        fm.voter_id,
        v.epic_no,
        v.name AS voter_name,
        v.relative_name,
        v.age,
        v.gender
      FROM family_members fm
      LEFT JOIN voters v ON fm.voter_id = v.id
      WHERE fm.family_id = ?
      ORDER BY v.name ASC
      `,
      [familyId]
    );

    console.log("✅ Family members data for family:", familyId, rows.length, "records");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching family members:", err);
    res.status(500).json({ message: "Error fetching family members", error: err.message });
  }
});


// ============================================================
// ✅ FAMILY MANAGEMENT - VIEW / UPDATE / DELETE
// ============================================================

// 7️⃣ Get Family List (with member count)
app.get("/api/families", async (req, res) => {
  try {
    const { panchayat_id, booth_no, village_name } = req.query;

    let sql = `
      SELECT 
        f.family_id, f.family_name, f.contact_no, f.party_support,
        f.village_name, f.booth_no, c.caste_name, p.panchayat_name,
        COUNT(m.voter_id) AS member_count
      FROM family_master f
      LEFT JOIN family_members m ON f.family_id = m.family_id
      LEFT JOIN caste_master c ON f.caste_code = c.caste_code
      LEFT JOIN panchayat_master p ON f.panchayat_id = p.panchayat_id
      WHERE 1=1
    `;

    const params = [];
    if (panchayat_id) {
      sql += " AND f.panchayat_id = ?";
      params.push(panchayat_id);
    }
    if (booth_no) {
      sql += " AND f.booth_no = ?";
      params.push(booth_no);
    }
    if (village_name) {
      sql += " AND f.village_name = ?";
      params.push(village_name);
    }

    sql += " GROUP BY f.family_id ORDER BY f.family_name ASC";
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching families:", err);
    res.status(500).json({ message: "Error fetching families" });
  }
});


// 8️⃣ Get Members of a Family
// ✅ Get Members of a Family (Now includes EPIC ID & Relative Name)
app.get("/api/family/:id/members", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT 
        fm.voter_id,
        v.epic_no,
        v.name AS voter_name,
        v.relative_name,
        v.age,
        v.gender
      FROM family_members fm
      INNER JOIN voters v ON fm.voter_id = v.id
      WHERE fm.family_id = ?
      ORDER BY v.name ASC
      `,
      [req.params.id]
    );

    // 👇 Add this one line (for test)
    console.log("✅ Family members data =>", rows);

    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching family members:", err);
    res.status(500).json({ message: "Error fetching family members" });
  }
});



// ✅ Delete entire family
app.delete("/api/family/:id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // get members
    const [members] = await conn.query("SELECT voter_id FROM family_members WHERE family_id = ?", [req.params.id]);

    // unlink voters
    for (const m of members) {
      await conn.query("UPDATE voters SET is_linked = 0 WHERE id = ?", [m.voter_id]);
    }

    // delete members + family
    await conn.query("DELETE FROM family_members WHERE family_id = ?", [req.params.id]);
    await conn.query("DELETE FROM family_master WHERE family_id = ?", [req.params.id]);

    await conn.commit();
    res.json({ message: "Family deleted successfully" });
  } catch (err) {
    await conn.rollback();
    console.error("Delete family error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ✅ Remove one member
app.delete("/api/family/member/:voter_id", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [row] = await conn.query("SELECT family_id FROM family_members WHERE voter_id = ?", [req.params.voter_id]);
    if (!row.length) return res.status(404).json({ error: "Member not found" });
    const family_id = row[0].family_id;

    await conn.query("DELETE FROM family_members WHERE voter_id = ?", [req.params.voter_id]);
    await conn.query("UPDATE voters SET is_linked = 0 WHERE id = ?", [req.params.voter_id]);
    await conn.commit();
    res.json({ message: "Member removed successfully", family_id });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ✅ Add a new member
app.post("/api/family/member", async (req, res) => {
  const { family_id, voter_id, voter_name, age, gender } = req.body;
  try {
    await pool.query(
      "INSERT INTO family_members (family_id, voter_id, voter_name, age, gender) VALUES (?, ?, ?, ?, ?)",
      [family_id, voter_id, voter_name, age, gender]
    );
    await pool.query("UPDATE voters SET is_linked = 1 WHERE id = ?", [voter_id]);
    res.json({ message: "Member added successfully" });
  } catch (err) {
    console.error("Error adding member:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================
// ✅ NEW API FOR HOME TAB — Get ALL voters with Panchayat & Village
// ============================================================
app.get("/api/voters/all", async (req, res) => {
  try {
    let { search = "", panchayat_id = "", booth_no = "", village_name = "", page = 1, limit = 500 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (panchayat_id) {
      where.push("v.panchayat_id = ?");
      params.push(panchayat_id);
    }

    if (booth_no) {
      where.push("v.booth_no = ?");
      params.push(booth_no);
    }

    if (village_name) {
      where.push("v.village_name = ?");
      params.push(village_name);
    }

    if (req.query.name) {
      where.push(`LOWER(name) LIKE LOWER(?)`);
      params.push(`%${req.query.name}%`);
    }

    if (req.query.relative_name) {
      where.push(`LOWER(relative_name) LIKE LOWER(?)`);
      params.push(`%${req.query.relative_name}%`);
    }


    const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

    const [rows] = await pool.query(
      `
      SELECT 
        v.id, 
        v.epic_no, 
        v.name, 
        v.relative_name, 
        v.age, 
        v.gender,
        v.mobile_number,
        v.booth_no,
        v.village_name,
        p.panchayat_name
      FROM voters v
      LEFT JOIN panchayat_master p ON v.panchayat_id = p.panchayat_id
      ${whereClause}
      ORDER BY v.id ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total FROM voters v ${whereClause}`,
      params
    );

    res.json({
      data: rows,
      total: countResult[0].total,
      page,
      per_page: limit,
      total_pages: Math.ceil(countResult[0].total / limit),
    });
  } catch (err) {
    console.error("❌ Error fetching all voters:", err);
    res.status(500).json({ error: err.message });
  }
});
// ✅ Get Unique Panchayats (for dropdown)
app.get("/api/panchayats", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT panchayat_name 
      FROM family_master 
      WHERE panchayat_name IS NOT NULL AND TRIM(panchayat_name) != ''
      ORDER BY panchayat_name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching panchayats:", err);
    res.status(500).json({ error: "Failed to fetch panchayats" });
  }
});


// ============================================================
// ✅ PARTY LEADERSHIP MANAGEMENT API (Correct Table)
// ============================================================

// Get all leaders
app.get("/api/leadership", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM party_leadership ORDER BY s_no ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching leadership:", err);
    res.status(500).json({ error: err.message });
  }
});

// Filter by union / panchayat / branch
app.get("/api/leadership/filter", async (req, res) => {
  try {
    const { union_name, panchayat_name, branch_name } = req.query;
    let where = "WHERE 1=1";
    const params = [];

    if (union_name) {
      where += " AND union_name = ?";
      params.push(union_name);
    }
    if (panchayat_name) {
      where += " AND panchayat_name = ?";
      params.push(panchayat_name);
    }
    if (branch_name) {
      where += " AND branch_name = ?";
      params.push(branch_name);
    }

    const [rows] = await pool.query(
      `SELECT * FROM party_leadership ${where} ORDER BY s_no ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("Error filtering leadership:", err);
    res.status(500).json({ error: err.message });
  }
});

// Add a new leader
app.post("/api/leadership", async (req, res) => {
  try {
    const { union_name, panchayat_name, branch_name, leader_name, phone_number } = req.body;
    if (!leader_name || !phone_number)
      return res.status(400).json({ error: "Name and phone number required" });

    await pool.query(
      `INSERT INTO party_leadership (union_name, panchayat_name, branch_name, leader_name, phone_number)
       VALUES (?, ?, ?, ?, ?)`,
      [union_name, panchayat_name, branch_name, leader_name, phone_number]
    );

    res.json({ message: "✅ Leader added successfully!" });
  } catch (err) {
    console.error("Error adding leader:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update leader
app.put("/api/leadership/:s_no", async (req, res) => {
  try {
    const { s_no } = req.params;
    const { union_name, panchayat_name, branch_name, leader_name, phone_number } = req.body;

    await pool.query(
      `UPDATE party_leadership 
       SET union_name=?, panchayat_name=?, branch_name=?, leader_name=?, phone_number=? 
       WHERE s_no=?`,
      [union_name, panchayat_name, branch_name, leader_name, phone_number, s_no]
    );

    res.json({ message: "✅ Leader updated successfully!" });
  } catch (err) {
    console.error("Error updating leader:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete leader
app.delete("/api/leadership/:s_no", async (req, res) => {
  try {
    const { s_no } = req.params;
    await pool.query("DELETE FROM party_leadership WHERE s_no = ?", [s_no]);
    res.json({ message: "🗑️ Leader deleted successfully!" });
  } catch (err) {
    console.error("Error deleting leader:", err);
    res.status(500).json({ error: err.message });
  }
});
// ---- add these inside server.js where 'pool' is available ----

/**
 * Helper: list of parties (columns) we analyze
 */
const PARTIES = [
  { key: "dravida_munnetra_kazhagam", label: "DMK" },
  { key: "desiya_murpokku_dravidar_kazhagam", label: "DMDK" },
  { key: "all_india_anna_dravidar_munnetra_kazhagam", label: "ADMK" },
  { key: "indiya_jananayaka_katchi", label: "IJK" },
  { key: "naam_tamilar_katchi", label: "NTK" },
];

/**
 * 1) Raw results (for debugging or CSV view)
 */
app.get("/api/election/results", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT booth_station, ${PARTIES.map((p) => p.key).join(", ")} 
       FROM election_results`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error loading election results:", err);
    res.status(500).json({ error: "Failed to load election results" });
  }
});

/**
 * 2) Party-wise performance summary (total votes + percentage)
 */
app.get("/api/election/party-summary", async (req, res) => {
  try {
    const cols = PARTIES.map((p) => `SUM(${p.key}) AS ${p.key}`).join(", ");
    const sql = `SELECT ${cols}, SUM(total_valid_votes) AS total_valid_votes FROM election_results`;
    const [rows] = await pool.query(sql);

    const row = rows[0] || {};
    const totalValid = Number(row.total_valid_votes || 0);

    const parties = PARTIES.map((p) => {
      const v = Number(row[p.key] || 0);
      return {
        key: p.key,
        label: p.label,
        votes: v,
        pct: totalValid ? +((v / totalValid) * 100).toFixed(2) : 0,
      };
    });

    res.json({ total_valid_votes: totalValid, parties });
  } catch (err) {
    console.error("Error computing party summary:", err);
    res.status(500).json({ error: "Failed to compute party summary" });
  }
});

/**
 * 3) Booth-wise winners & winner counts
 */
app.get("/api/election/winners", async (req, res) => {
  try {
    const [allRows] = await pool.query("SELECT * FROM election_results ORDER BY booth_station");
    const perBooth = allRows.map((r) => {
      const partyVotes = PARTIES.map((p) => ({
        key: p.key,
        label: p.label,
        votes: Number(r[p.key] || 0),
      })).sort((a, b) => b.votes - a.votes);

      const winner = partyVotes[0];
      const runnerUp = partyVotes[1];
      const margin = winner ? winner.votes - (runnerUp ? runnerUp.votes : 0) : 0;

      return {
        booth_station: r.booth_station,
        winner: winner ? winner.label : null,
        margin,
        total_valid_votes: Number(r.total_valid_votes || 0),
      };
    });

    // Count booths per winner
    const counts = {};
    perBooth.forEach((b) => {
      const w = b.winner || "UNKNOWN";
      counts[w] = (counts[w] || 0) + 1;
    });

    res.json({ perBooth, winnerCounts: counts });
  } catch (err) {
    console.error("Error computing winners:", err);
    res.status(500).json({ error: "Failed to compute winners" });
  }
});

/**
 * 4) Booth-level analytics (used when selecting a booth)
 */
app.get("/api/election/booth/:booth", async (req, res) => {
  try {
    const booth = req.params.booth;
    const [rows] = await pool.query("SELECT * FROM election_results WHERE booth_station = ?", [booth]);
    if (!rows.length) return res.status(404).json({ error: "Booth not found" });

    const r = rows[0];
    const totalValid = Number(r.total_valid_votes || 0) || 1;

    const parties = PARTIES.map((p) => {
      const v = Number(r[p.key] || 0);
      return {
        key: p.key,
        label: p.label,
        votes: v,
        pct: +((v / totalValid) * 100).toFixed(2),
      };
    }).sort((a, b) => b.votes - a.votes);

    const winner = parties[0];
    const runnerUp = parties[1] || { votes: 0 };
    const margin = winner.votes - runnerUp.votes;

    res.json({
      booth_station: r.booth_station,
      parties,
      winner: winner.label,
      margin,
      total_valid_votes: totalValid,
    });
  } catch (err) {
    console.error("Error fetching booth details:", err);
    res.status(500).json({ error: "Failed to load booth details" });
  }
});

// ✅ Booth voter count directly from election_results
app.get("/api/election/booth/:booth/voters", async (req, res) => {
  try {
    const booth = req.params.booth;
    const [rows] = await pool.query(
      `SELECT total_votes AS total_voters FROM election_results WHERE booth_station = ? LIMIT 1`,
      [booth]
    );
    const total = rows.length ? Number(rows[0].total_voters || 0) : 0;
    res.json({ total_voters: total });
  } catch (err) {
    console.error("Error fetching booth voter count:", err);
    res.status(500).json({ error: "Failed to fetch booth voter count" });
  }
});


/**
 * 6) NTK / IJK Penetration (booths where small parties cross % threshold)
 */
app.get("/api/election/smallparty-penetration", async (req, res) => {
  try {
    const threshold = Number(req.query.threshold || 10);
    const [rows] = await pool.query("SELECT * FROM election_results");

    const list = rows
      .map((r) => {
        const total = Number(r.total_valid_votes || 0) || 1;
        const ntk_pct = (Number(r.naam_tamilar_katchi || 0) / total) * 100;
        const ijk_pct = (Number(r.indiya_jananayaka_katchi || 0) / total) * 100;
        return {
          booth_station: r.booth_station,
          ntk_votes: Number(r.naam_tamilar_katchi || 0),
          ntk_pct: +ntk_pct.toFixed(2),
          ijk_votes: Number(r.indiya_jananayaka_katchi || 0),
          ijk_pct: +ijk_pct.toFixed(2),
        };
      })
      .filter((x) => x.ntk_pct >= threshold || x.ijk_pct >= threshold)
      .sort((a, b) => Math.max(b.ntk_pct, b.ijk_pct) - Math.max(a.ntk_pct, a.ijk_pct));

    res.json({ threshold, booths: list });
  } catch (err) {
    console.error("Error computing small party penetration:", err);
    res.status(500).json({ error: "Failed to compute small party penetration" });
  }
});

/**
 * 7) Get list of booth stations (used for dropdown)
 */
app.get("/api/election/booths", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT booth_station FROM election_results ORDER BY booth_station ASC`
    );
    const booths = rows.map((r) => r.booth_station);
    res.json({ booths });
  } catch (err) {
    console.error("Error fetching booth list:", err);
    res.status(500).json({ error: "Failed to load booth list" });
  }
});

// ============================================================
// ✅ START SERVER (Render-compatible)
// ============================================================
const PORT = process.env.PORT || 4000;

app.get("/", (req, res) => {
  res.send("✅ Political Backend is Live on Render!");
});

app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
