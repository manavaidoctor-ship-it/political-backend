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

    // 🧹 Create table if it doesn’t exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS election_results (
        booth_station VARCHAR(50),
        dravida_munnetra_kazhagam INT,
        desiya_murpokku_dravidar_kazhagam INT,
        all_india_anna_dravidar_munnetra_kazhagam INT,
        indiya_jananayaka_katchi INT,
        naam_tamilar_katchi INT,
        total_valid_votes INT,
        rejected_votes INT,
        nota INT,
        total_votes INT
      )
    `);

    // 🧹 Clear old data
    await pool.query("TRUNCATE TABLE election_results");
    console.log("🧹 Old data cleared from election_results table!");

    // ✅ Read CSV file from Desktop
    const filePath = "C:\\Users\\ADMIN\\Desktop\\election_data.csv";
    const workbook = XLSX.readFile(filePath, { codepage: 65001 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`📊 Total rows found in file: ${data.length}`);

    let batch = [];
    let insertedCount = 0;
    const failedRows = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // ✅ Safely map possible header names
      const booth_number =
        row["Booth_Number"] ||
        row["Booth Station"] ||
        row["Booth_Station"] ||
        row["booth_station"] ||
        row["booth_number"] ||
        "";

      const dmk = row["Dravida Munnetra Kazhagam"] || 0;
      const dmdk = row["Desiya Murpokku Dravida Kazhagam"] || 0;
      const admk = row["All India Anna Dravida Munnetra Kazhagam"] || 0;
      const ijk = row["Indiya Jananayaka Katchi"] || 0;
      const ntk = row["Naam Tamilar Katchi"] || 0;
      const total_valid = row["Total of Valid Votes"] || 0;
      const rejected = row["No. Of Rejected Votes"] || 0;
      const nota = row["NOTA"] || 0;
      const total = row["Total"] || 0;

      batch.push([
        booth_number,
        dmk,
        dmdk,
        admk,
        ijk,
        ntk,
        total_valid,
        rejected,
        nota,
        total,
      ]);

      // Insert in batches of 200
      if (batch.length === 200) {
        try {
          await pool.query(
            `INSERT INTO election_results (
              booth_station, dravida_munnetra_kazhagam, desiya_murpokku_dravidar_kazhagam,
              all_india_anna_dravidar_munnetra_kazhagam, indiya_jananayaka_katchi,
              naam_tamilar_katchi, total_valid_votes, rejected_votes, nota, total_votes
            ) VALUES ?`,
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

    // Insert remaining rows
    if (batch.length > 0) {
      try {
        await pool.query(
          `INSERT INTO election_results (
            booth_station, dravida_munnetra_kazhagam, desiya_murpokku_dravidar_kazhagam,
            all_india_anna_dravidar_munnetra_kazhagam, indiya_jananayaka_katchi,
            naam_tamilar_katchi, total_valid_votes, rejected_votes, nota, total_votes
          ) VALUES ?`,
          [batch]
        );
        insertedCount += batch.length;
        console.log(`✅ Inserted remaining ${batch.length} rows. Total: ${insertedCount}/${data.length}`);
      } catch (err) {
        console.error("⚠️ Final batch failed:", err.message);
        failedRows.push(...batch);
      }
    }

    // ✅ Log failed rows
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
