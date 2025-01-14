const sql = require("mssql");
require("dotenv").config();

const dbConfig = {
  user: process.env.db_user,
  password: process.env.db_password,
  server: process.env.server,
  database: process.env.database,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    trustedConnection: false,
    enableArithAbort: true,
  },
  port: process.env.port,
};

const poolPromise = new sql.ConnectionPool(dbConfig)
  .connect()
  .then((pool) => {
    console.log("Connected to SQL Server");
    return pool;
  })
  .catch((err) => {
    console.error("Database connection failed:", err);
  });

  async function getSettings() {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT TOP 1 * FROM settings");
    return result.recordset[0];
  }

module.exports = { poolPromise, sql,getSettings  };
