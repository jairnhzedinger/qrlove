const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const logger = require('./logger');

// Carregar variáveis de ambiente
dotenv.config();

// Criar pool de conexões com o banco de dados
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0
});

const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logger.info('Conexão com o banco de dados estabelecida.');
  } catch (error) {
    logger.error('Erro ao conectar ao banco de dados.', { error: error.message });
  }
};

testConnection();

// Função para criar um novo registro e retornar o ID inserido
const createRecord = async (table, data) => {
  const sql = `INSERT INTO ${table} SET ?`;

  try {
    const [results] = await pool.query(sql, [data]);
    logger.info(`Registro inserido com sucesso na tabela ${table}.`, { id: results.insertId });
    return { id: results.insertId, ...data };
  } catch (error) {
    logger.error(`Erro ao inserir registro na tabela ${table}.`, { error: error.message });
    throw error;
  }
};

// Função para buscar um único registro com condições
const getRecord = async (table, conditions) => {
  const conditionKeys = Object.keys(conditions).map(key => `${key} = ?`).join(' AND ');
  const conditionValues = Object.values(conditions);
  const sql = `SELECT * FROM ${table} WHERE ${conditionKeys} LIMIT 1`;

  try {
    const [results] = await pool.query(sql, conditionValues);
    if (results.length > 0) {
      logger.info(`Registro encontrado na tabela ${table}.`, { conditions });
      return results[0];
    }

    logger.warn(`Nenhum registro encontrado na tabela ${table}.`, { conditions });
    return null;
  } catch (error) {
    logger.error(`Erro ao buscar registro na tabela ${table}.`, { error: error.message });
    throw error;
  }
};

// Função para alterar um registro existente
const updateRecord = async (table, data, id) => {
  const sql = `UPDATE ${table} SET ? WHERE id = ?`;

  try {
    const [results] = await pool.query(sql, [data, id]);
    logger.info(`Registro atualizado com sucesso na tabela ${table}.`, { id });
    return results;
  } catch (error) {
    logger.error(`Erro ao atualizar registro na tabela ${table}.`, { error: error.message, id });
    throw error;
  }
};

// Função para excluir um registro
const deleteRecord = async (table, id) => {
  const sql = `DELETE FROM ${table} WHERE id = ?`;

  try {
    const [results] = await pool.query(sql, [id]);
    logger.info(`Registro excluído com sucesso da tabela ${table}.`, { id });
    return results;
  } catch (error) {
    logger.error(`Erro ao excluir registro na tabela ${table}.`, { error: error.message, id });
    throw error;
  }
};

// Função para consultar múltiplos registros com condições opcionais
const queryRecords = async (table, conditions = '') => {
  const sql = `SELECT * FROM ${table} ${conditions}`;

  try {
    const [results] = await pool.query(sql);
    logger.info(`Consulta realizada na tabela ${table}.`, { registros: results.length });
    return results;
  } catch (error) {
    logger.error(`Erro ao consultar registros na tabela ${table}.`, { error: error.message });
    throw error;
  }
};

// Exportar funções
module.exports = {
  createRecord,
  updateRecord,
  deleteRecord,
  queryRecords,
  getRecord,
  pool
};
