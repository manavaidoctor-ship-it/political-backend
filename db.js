const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,        // From Render Environment
  user: process.env.DB_USER,        // From Render Environment
  password: process.env.DB_PASS,    // From Render Environment
  database: process.env.DB_NAME,    // From Render Environment
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
