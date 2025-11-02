const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');

dotenv.config();

const ADMIN_EMAIL = 'jair.edinger2@live.com';
const ADMIN_PASSWORD = 'casa2020';
const BCRYPT_SALT_ROUNDS = 12;

const tables = [
  `CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS partners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) DEFAULT NULL,
    phone VARCHAR(50) DEFAULT NULL,
    status ENUM('ativo','inativo','pendente') DEFAULT 'pendente',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    discount_type ENUM('percentual','valor_fixo') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    usage_limit INT DEFAULT NULL,
    used_count INT DEFAULT 0,
    start_date DATE DEFAULT NULL,
    end_date DATE DEFAULT NULL,
    active TINYINT(1) DEFAULT 1,
    partner_id INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_coupons_partner FOREIGN KEY (partner_id)
      REFERENCES partners(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS financial_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_type ENUM('entrada','saida') NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    description TEXT,
    reference VARCHAR(255) DEFAULT NULL,
    occurred_at DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`
];

async function ensureAdmin(connection) {
  const [rows] = await connection.query('SELECT id FROM admins WHERE email = ?', [ADMIN_EMAIL]);

  if (rows.length) {
    console.info('Admin já existente. Nenhuma ação necessária.');
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_SALT_ROUNDS);
  await connection.query(
    'INSERT INTO admins (email, password_hash, name) VALUES (?, ?, ?)',
    [ADMIN_EMAIL, passwordHash, 'Administrador QRLove']
  );
  console.info('Administrador padrão criado com sucesso.');
}

async function runMigrations() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      multipleStatements: true
    });

    for (const statement of tables) {
      await connection.query(statement);
      console.info('Migration executada:', statement.split('(')[0].trim());
    }

    await ensureAdmin(connection);
    console.info('Migrations finalizadas com sucesso.');
  } catch (error) {
    console.error('Erro ao executar migrations:', error.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigrations();

