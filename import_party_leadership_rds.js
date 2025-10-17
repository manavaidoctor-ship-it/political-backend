require("dotenv").config();
const mysql = require("mysql2/promise");
const XLSX = require("xlsx");
const fs = require("fs");

(async () => {
  try {
    // ✅ Connect to AWS RDS
    const pool = await mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      charset: "utf8mb4",
      ssl: { rejectUnauthorized: false },
      connectionLimit: 5,
    });

    console.log("✅ Connected to AWS RDS successfully!");

    // 🧹 Clear old data
    await pool.query("TRUNCATE TABLE party_leadership");
    console.log("🧹 Old data cleared from party_leadership table!");

    // ✅ Read Excel
    const dataBuffer = fs.readFileSync("./booth_sec_webdata.xlsx");
    const workbook = XLSX.read(dataBuffer, { type: "buffer", codepage: 65001 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`📊 Total rows found in Excel: ${data.length}`);

    let batch = [];
    let insertedCount = 0;
    const failedRows = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const union_name = row["Union"] || "";
      const panchayat_name = row["Panchayat"] || "";
      const branch_name = row["Branch(KIZHAI)"] || "";
      const leader_name = row["Name"] || "";
      const phone_number = row["Phone number"] || "";

      batch.push([union_name, panchayat_name, branch_name, leader_name, phone_number]);

      // ✅ Every 200 rows, insert and reset batch
      if (batch.length === 200) {
        try {
          await pool.query(
            `INSERT INTO party_leadership (union_name, panchayat_name, branch_name, leader_name, phone_number)
             VALUES ?`,
            [batch]
          );
          insertedCount += batch.length;
          console.log(`✅ Inserted ${insertedCount}/${data.length}`);
        } catch (err) {
          console.error("⚠️ Batch insert failed:", err.message);
          failedRows.push(...batch);
        }
        batch = [];
      }
    }

    // ✅ Handle leftover rows (if any)
    if (batch.length > 0) {
      try {
        await pool.query(
          `INSERT INTO party_leadership (union_name, panchayat_name, branch_name, leader_name, phone_number)
           VALUES ?`,
          [batch]
        );
        insertedCount += batch.length;
        console.log(`✅ Inserted remaining ${batch.length} rows. Total: ${insertedCount}/${data.length}`);
      } catch (err) {
        console.error("⚠️ Final batch failed:", err.message);
        failedRows.push(...batch);
      }
    }

    // ✅ Log failed rows if any
    if (failedRows.length > 0) {
      fs.writeFileSync("failed_rows.log", JSON.stringify(failedRows, null, 2), "utf-8");
      console.warn(`⚠️ ${failedRows.length} rows failed to insert. Logged to failed_rows.log`);
    }

    console.log(`🎉 Import complete! Total successfully inserted: ${insertedCount}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error importing data:", err);
    process.exit(1);
  }
})();
