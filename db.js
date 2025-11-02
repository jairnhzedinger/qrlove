const mysql = require('mysql2');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente
dotenv.config();

// Criar conexão com o banco de dados
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Conectar ao banco de dados
connection.connect((err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
    return;
  }
  console.log('Conexão com o banco de dados estabelecida.');
});

// Função para criar um novo registro e retornar o ID inserido
const createRecord = (table, data) => {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO ${table} SET ?`;
    connection.query(sql, data, (err, results) => {
      if (err) {
        console.error(`Erro ao inserir registro na tabela ${table}:`, err);
        reject(err);
      } else {
        console.log(`Registro inserido com sucesso na tabela ${table}. ID: ${results.insertId}`);
        resolve({ id: results.insertId, ...data }); // Retorna o ID inserido
      }
    });
  });
};

// Função para buscar um único registro com condições
const getRecord = (table, conditions) => {
  return new Promise((resolve, reject) => {
    const conditionKeys = Object.keys(conditions).map(key => `${key} = ?`).join(' AND ');
    const conditionValues = Object.values(conditions);

    const sql = `SELECT * FROM ${table} WHERE ${conditionKeys} LIMIT 1`;
    connection.query(sql, conditionValues, (err, results) => {
      if (err) {
        console.error(`Erro ao buscar registro na tabela ${table}:`, err);
        reject(err);
      } else {
        if (results.length > 0) {
          console.log(`Registro encontrado na tabela ${table}:`, results[0]);
          resolve(results[0]); // Retorna o primeiro registro encontrado
        } else {
          console.log(`Nenhum registro encontrado na tabela ${table} para as condições especificadas.`);
          resolve(null);
        }
      }
    });
  });
};

// Função para alterar um registro existente
const updateRecord = (table, data, id) => {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE ${table} SET ? WHERE id = ?`;
    connection.query(sql, [data, id], (err, results) => {
      if (err) {
        console.error(`Erro ao atualizar registro na tabela ${table}:`, err);
        reject(err);
      } else {
        console.log(`Registro atualizado com sucesso na tabela ${table}.`);
        resolve(results);
      }
    });
  });
};

// Função para excluir um registro
const deleteRecord = (table, id) => {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM ${table} WHERE id = ?`;
    connection.query(sql, id, (err, results) => {
      if (err) {
        console.error(`Erro ao excluir registro na tabela ${table}:`, err);
        reject(err);
      } else {
        console.log(`Registro excluído com sucesso da tabela ${table}.`);
        resolve(results);
      }
    });
  });
};

// Função para consultar múltiplos registros com condições opcionais
const queryRecords = (table, conditions = '') => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM ${table} ${conditions}`;
    connection.query(sql, (err, results) => {
      if (err) {
        console.error(`Erro ao consultar registros na tabela ${table}:`, err);
        reject(err);
      } else {
        console.log(`Registros encontrados na tabela ${table}:`, results.length);
        resolve(results);
      }
    });
  });
};

// Exportar funções
module.exports = {
  createRecord,
  updateRecord,
  deleteRecord,
  queryRecords,
  getRecord,
};
