jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const mockQuery = jest.fn();
const mockGetConnection = jest.fn();
const mockPing = jest.fn().mockResolvedValue();
const mockRelease = jest.fn();

jest.mock('mysql2/promise', () => {
  return {
    createPool: jest.fn(() => ({
      query: mockQuery,
      getConnection: mockGetConnection
    }))
  };
});

describe('db helpers', () => {
  let logger;
  let db;

  beforeEach(async () => {
    mockQuery.mockReset();
    mockGetConnection.mockReset();
    mockPing.mockReset();
    mockRelease.mockReset();
    mockGetConnection.mockResolvedValue({ ping: mockPing, release: mockRelease });

    jest.resetModules();

    logger = require('../logger');
    db = require('../db');
  });

  it('cria registro e retorna dados com ID', async () => {
    mockQuery.mockResolvedValueOnce([{ insertId: 42 }]);

    const result = await db.createRecord('purchases', { couple_name: 'Ana' });

    expect(mockQuery).toHaveBeenCalledWith('INSERT INTO purchases SET ?', [{ couple_name: 'Ana' }]);
    expect(result).toEqual({ id: 42, couple_name: 'Ana' });
    expect(logger.info).toHaveBeenCalledWith('Registro inserido com sucesso na tabela purchases.', { id: 42 });
  });

  it('retorna null e gera log de aviso quando nenhum registro é encontrado', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const result = await db.getRecord('images', { purchase_id: 1 });

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM images WHERE purchase_id = ? LIMIT 1', [1]);
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('Nenhum registro encontrado na tabela images.', { conditions: { purchase_id: 1 } });
  });

  it('propaga erro ao consultar registros', async () => {
    const error = new Error('falha');
    mockQuery.mockRejectedValueOnce(error);

    await expect(db.queryRecords('purchases')).rejects.toThrow('falha');
    expect(logger.error).toHaveBeenCalledWith('Erro ao consultar registros na tabela purchases.', { error: error.message });
  });
});
