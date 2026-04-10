require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

client.connect()
  .then(() => console.log('✅ CONECTOU NO BANCO'))
  .catch(err => console.error('❌ ERRO REAL:', err.message))
  .finally(() => client.end());