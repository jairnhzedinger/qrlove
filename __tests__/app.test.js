const request = require('supertest');

jest.mock('../db', () => ({
  createRecord: jest.fn(),
  getRecord: jest.fn(),
  updateRecord: jest.fn(),
  deleteRecord: jest.fn(),
  queryRecords: jest.fn(),
  pool: {}
}));

const mockStripeSessionCreate = jest.fn();
const mockStripeConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockStripeSessionCreate
      }
    },
    webhooks: {
      constructEvent: mockStripeConstructEvent
    }
  }));
});

jest.mock('sharp', () => {
  const rotateMock = jest.fn().mockReturnThis();
  const compositeMock = jest.fn().mockReturnThis();
  const toFileMock = jest.fn().mockResolvedValue();
  const metadataMock = jest.fn().mockResolvedValue({ width: 1000, height: 500 });

  const sharpMock = jest.fn(() => ({
    metadata: metadataMock,
    rotate: rotateMock,
    composite: compositeMock,
    toFile: toFileMock
  }));

  sharpMock.__mocks = { rotateMock, compositeMock, toFileMock, metadataMock };

  return sharpMock;
});

jest.mock('qrcode', () => ({
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('qr'))
}));

process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
process.env.BASE_URL = 'http://localhost:7500';

const app = require('../app');

describe('App rotas públicas', () => {
  it('retorna a chave pública do Stripe em /config', async () => {
    const response = await request(app).get('/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ publicKey: 'pk_test' });
  });

  it('retorna erro quando o plano é inválido na criação da sessão', async () => {
    const response = await request(app)
      .post('/create-checkout-session')
      .field('coupleName', 'Ana & Beto')
      .field('planId', '999')
      .field('startDate', '2024-01-01');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Plano não encontrado' });
  });
});
