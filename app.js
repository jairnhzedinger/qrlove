const express = require('express');
const Stripe = require('stripe');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto'); // Para gerar a hash única
const multer = require('multer'); // Biblioteca para upload de arquivos
const bodyParser = require('body-parser');
const QRCode = require('qrcode'); // Biblioteca para gerar QR Codes
const sharp = require('sharp'); // Biblioteca para manipulação de imagens
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./db'); // Importar o módulo db.js
const logger = require('./logger');

// Carregar variáveis de ambiente
dotenv.config();

// Inicializar Stripe com a chave secreta
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// Middlewares de logging e identificação de requisições
app.use((req, res, next) => {
  if (!req.requestId) {
    const idGenerator = crypto.randomUUID || (() => crypto.randomBytes(16).toString('hex'));
    req.requestId = idGenerator();
  }
  res.locals.requestId = req.requestId;
  next();
});

app.use((req, res, next) => {
  logger.info('Requisição recebida.', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl
  });

  res.on('finish', () => {
    logger.info('Requisição finalizada.', {
      requestId: req.requestId,
      statusCode: res.statusCode
    });
  });

  next();
});

// Configurar parser JSON apenas para rotas que não sejam webhook
const jsonParser = express.json({ limit: '1mb' });
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/webhook')) {
    return next();
  }

  return jsonParser(req, res, next);
});

app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'qrlove-dashboard-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 4
  }
}));

const setFlash = (req, type, message) => {
  req.session.flash = { type, message };
};

const requireAuth = (req, res, next) => {
  if (req.session && req.session.adminId) {
    return next();
  }

  if (req.path === '/dashboard') {
    logger.warn('Acesso ao dashboard sem autenticação.', { requestId: req.requestId });
  }

  return res.redirect('/dashboard/login');
};

app.use((req, res, next) => {
  res.locals.currentAdminEmail = req.session && req.session.adminEmail ? req.session.adminEmail : null;
  res.locals.flash = req.session && req.session.flash ? req.session.flash : null;
  if (req.session && req.session.flash) {
    delete req.session.flash;
  }
  next();
});

// Configurações
app.use(express.static(path.join(__dirname, 'public'))); // Servir arquivos estáticos (CSS, imagens)
app.set('view engine', 'ejs'); // Configurar EJS como engine de templates

logger.info('Servidor iniciado.');

// Enviar a chave pública para o frontend
app.get('/config', (req, res) => {
  try {
    res.json({ publicKey: process.env.STRIPE_PUBLISHABLE_KEY });
  } catch (error) {
    logger.error('Erro ao enviar chave pública.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).json({ error: 'Erro ao obter a chave pública.' });
  }
});

// Função para gerar uma hash única
function generateUniqueHash() {
  return crypto.randomBytes(16).toString('hex');
}

async function loadDashboardData() {
  const [partners, coupons, transactions] = await Promise.all([
    db.queryRecords('partners'),
    db.queryRecords('coupons'),
    db.queryRecords('financial_transactions')
  ]);

  const revenue = transactions
    .filter(transaction => transaction.transaction_type === 'entrada')
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const expenses = transactions
    .filter(transaction => transaction.transaction_type === 'saida')
    .reduce((total, transaction) => total + Number(transaction.amount), 0);

  const now = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(now.getDate() + 7);

  const activeCoupons = coupons.filter(coupon => coupon.active === 1);
  const expiringCoupons = coupons.filter(coupon => {
    if (!coupon.end_date) {
      return false;
    }

    const endDate = new Date(coupon.end_date);
    return endDate >= now && endDate <= nextWeek;
  });

  const totalCouponUsage = coupons.reduce((accumulator, coupon) => accumulator + (coupon.used_count || 0), 0);
  const totalCouponLimit = coupons.reduce((accumulator, coupon) => accumulator + (coupon.usage_limit || 0), 0);
  const usageRate = totalCouponLimit > 0 ? Math.round((totalCouponUsage / totalCouponLimit) * 100) : null;

  const metrics = {
    totalPartners: partners.length,
    activePartners: partners.filter(partner => partner.status === 'ativo').length,
    pendingPartners: partners.filter(partner => partner.status === 'pendente').length,
    totalCoupons: coupons.length,
    activeCoupons: activeCoupons.length,
    couponsExpiringSoon: expiringCoupons.length,
    couponUsageRate: usageRate,
    revenue,
    expenses,
    balance: revenue - expenses
  };

  return {
    partners,
    coupons,
    transactions,
    metrics
  };
}

// Configuração do multer para salvar as imagens no diretório public/media
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/media'); // Salvando as imagens no diretório 'public/media'
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const extension = path.extname(file.originalname); // Preservar a extensão do arquivo
    cb(null, uniqueSuffix + extension); // Nome do arquivo renomeado com hash + extensão
  }
});

const upload = multer({ storage }); // Inicializar o multer com a configuração

// Rota padrão /
app.get('/', (req, res) => {
  try {
    logger.info('Renderizando página inicial.', { requestId: req.requestId });
    res.render('index');
  } catch (error) {
    logger.error('Erro ao renderizar a página inicial.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).send("Erro ao carregar a página.");
  }
});

app.get('/dashboard/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/dashboard');
  }

  res.render('dashboard/login');
});

app.post('/dashboard/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    setFlash(req, 'error', 'Informe e-mail e senha.');
    return res.redirect('/dashboard/login');
  }

  try {
    const admin = await db.getRecord('admins', { email });

    if (!admin) {
      setFlash(req, 'error', 'Credenciais inválidas.');
      logger.warn('Tentativa de login com usuário inexistente.', { email });
      return res.redirect('/dashboard/login');
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);

    if (!passwordValid) {
      setFlash(req, 'error', 'Credenciais inválidas.');
      logger.warn('Senha inválida informada no login.', { email });
      return res.redirect('/dashboard/login');
    }

    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    setFlash(req, 'success', 'Login realizado com sucesso.');
    logger.info('Admin autenticado com sucesso.', { email });
    return res.redirect('/dashboard');
  } catch (error) {
    logger.error('Erro ao realizar login.', { error: error.message, email });
    setFlash(req, 'error', 'Não foi possível realizar o login. Tente novamente.');
    return res.redirect('/dashboard/login');
  }
});

app.post('/dashboard/logout', requireAuth, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      logger.error('Erro ao encerrar sessão do admin.', { error: error.message });
    }
    res.clearCookie('connect.sid');
    res.redirect('/dashboard/login');
  });
});

app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const data = await loadDashboardData();
    res.render('dashboard/index', data);
  } catch (error) {
    logger.error('Erro ao carregar dashboard.', { error: error.message });
    setFlash(req, 'error', 'Não foi possível carregar o dashboard.');
    res.redirect('/');
  }
});

app.post('/dashboard/partners', requireAuth, async (req, res) => {
  const { name, email, phone, status, notes } = req.body;

  if (!name) {
    setFlash(req, 'error', 'Informe o nome do parceiro.');
    return res.redirect('/dashboard');
  }

  const allowedStatus = ['ativo', 'inativo', 'pendente'];
  const normalizedStatus = allowedStatus.includes(status) ? status : 'pendente';

  try {
    await db.createRecord('partners', {
      name: name.trim(),
      email: email ? email.trim() : null,
      phone: phone ? phone.trim() : null,
      status: normalizedStatus,
      notes: notes || null
    });
    setFlash(req, 'success', 'Parceiro cadastrado com sucesso.');
  } catch (error) {
    logger.error('Erro ao cadastrar parceiro.', { error: error.message });
    setFlash(req, 'error', 'Não foi possível cadastrar o parceiro.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/partners/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const allowedStatus = ['ativo', 'inativo', 'pendente'];
  const partnerId = Number(req.params.id);

  if (!allowedStatus.includes(status)) {
    setFlash(req, 'error', 'Status inválido informado.');
    return res.redirect('/dashboard');
  }

  try {
    await db.updateRecord('partners', { status }, partnerId);
    setFlash(req, 'success', 'Status do parceiro atualizado.');
  } catch (error) {
    logger.error('Erro ao atualizar status do parceiro.', { error: error.message, partnerId });
    setFlash(req, 'error', 'Não foi possível atualizar o status.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/partners/:id/delete', requireAuth, async (req, res) => {
  const partnerId = Number(req.params.id);

  try {
    await db.deleteRecord('partners', partnerId);
    setFlash(req, 'success', 'Parceiro removido com sucesso.');
  } catch (error) {
    logger.error('Erro ao remover parceiro.', { error: error.message, partnerId });
    setFlash(req, 'error', 'Não foi possível remover o parceiro.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/coupons', requireAuth, async (req, res) => {
  const {
    code,
    description,
    discountType,
    discountValue,
    usageLimit,
    startDate,
    endDate,
    partnerId,
    active
  } = req.body;

  if (!code || !discountValue || !discountType) {
    setFlash(req, 'error', 'Preencha código, tipo e valor do desconto.');
    return res.redirect('/dashboard');
  }

  const parsedDiscountValue = Number.parseFloat(discountValue);
  if (Number.isNaN(parsedDiscountValue) || parsedDiscountValue <= 0) {
    setFlash(req, 'error', 'Valor de desconto inválido.');
    return res.redirect('/dashboard');
  }

  const normalizedType = discountType === 'valor_fixo' ? 'valor_fixo' : 'percentual';
  const parsedUsageLimit = usageLimit ? Number.parseInt(usageLimit, 10) : null;
  const normalizedPartnerId = partnerId ? Number.parseInt(partnerId, 10) || null : null;
  const isActive = active === 'on' ? 1 : 0;

  try {
    await db.createRecord('coupons', {
      code: code.trim().toUpperCase(),
      description: description || null,
      discount_type: normalizedType,
      discount_value: parsedDiscountValue,
      usage_limit: parsedUsageLimit,
      used_count: 0,
      start_date: startDate || null,
      end_date: endDate || null,
      active: isActive,
      partner_id: normalizedPartnerId
    });
    setFlash(req, 'success', 'Cupom cadastrado com sucesso.');
  } catch (error) {
    logger.error('Erro ao cadastrar cupom.', { error: error.message });
    setFlash(req, 'error', 'Não foi possível cadastrar o cupom.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/coupons/:id/toggle', requireAuth, async (req, res) => {
  const couponId = Number(req.params.id);

  try {
    const coupon = await db.getRecord('coupons', { id: couponId });

    if (!coupon) {
      setFlash(req, 'error', 'Cupom não encontrado.');
      return res.redirect('/dashboard');
    }

    const newStatus = coupon.active === 1 ? 0 : 1;
    await db.updateRecord('coupons', { active: newStatus }, couponId);
    setFlash(req, 'success', `Cupom ${newStatus === 1 ? 'ativado' : 'desativado'} com sucesso.`);
  } catch (error) {
    logger.error('Erro ao atualizar status do cupom.', { error: error.message, couponId });
    setFlash(req, 'error', 'Não foi possível atualizar o cupom.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/coupons/:id/delete', requireAuth, async (req, res) => {
  const couponId = Number(req.params.id);

  try {
    await db.deleteRecord('coupons', couponId);
    setFlash(req, 'success', 'Cupom removido com sucesso.');
  } catch (error) {
    logger.error('Erro ao remover cupom.', { error: error.message, couponId });
    setFlash(req, 'error', 'Não foi possível remover o cupom.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/transactions', requireAuth, async (req, res) => {
  const { transactionType, amount, occurredAt, description, reference } = req.body;

  if (!transactionType || !['entrada', 'saida'].includes(transactionType)) {
    setFlash(req, 'error', 'Tipo de transação inválido.');
    return res.redirect('/dashboard');
  }

  const parsedAmount = Number.parseFloat(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    setFlash(req, 'error', 'Informe um valor válido para a transação.');
    return res.redirect('/dashboard');
  }

  try {
    await db.createRecord('financial_transactions', {
      transaction_type: transactionType,
      amount: parsedAmount,
      description: description || null,
      reference: reference || null,
      occurred_at: occurredAt || new Date().toISOString().slice(0, 10)
    });
    setFlash(req, 'success', 'Transação registrada com sucesso.');
  } catch (error) {
    logger.error('Erro ao registrar transação financeira.', { error: error.message });
    setFlash(req, 'error', 'Não foi possível registrar a transação.');
  }

  res.redirect('/dashboard');
});

app.post('/dashboard/transactions/:id/delete', requireAuth, async (req, res) => {
  const transactionId = Number(req.params.id);

  try {
    await db.deleteRecord('financial_transactions', transactionId);
    setFlash(req, 'success', 'Transação removida com sucesso.');
  } catch (error) {
    logger.error('Erro ao remover transação financeira.', { error: error.message, transactionId });
    setFlash(req, 'error', 'Não foi possível remover a transação.');
  }

  res.redirect('/dashboard');
});

// Endpoint de criação de sessão de checkout, incluindo upload da imagem
app.post('/create-checkout-session', upload.single('photo'), async (req, res) => {
  try {
    logger.info('Requisição para /create-checkout-session.', { requestId: req.requestId });
    const { coupleName, planId, startDate } = req.body; // Dados do formulário
    const rawPromoCode = req.body.promoCode;
    const promoCode = typeof rawPromoCode === 'string' ? rawPromoCode.trim() : '';
    const normalizedInputCode = promoCode ? promoCode.toUpperCase() : '';
    const photoFile = req.file; // Arquivo da imagem enviada

    logger.info('Dados recebidos para criação de sessão.', {
      requestId: req.requestId,
      coupleName,
      planId,
      startDate,
      promoCode: promoCode || null
    });

    const products = [
      { id: 1, name: 'Anual', price: 1990 },
      { id: 2, name: 'Lifetime', price: 4990 },
    ];

    const product = products.find(p => p.id === Number(planId));

    if (!product) {
      logger.warn('Plano não encontrado.', {
        requestId: req.requestId,
        planId
      });
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    // Gerar a hash única
    const uniqueHash = generateUniqueHash();

    // Criar a URL de sucesso com o coupleName e a hash codificados
    const purchaseLink = `${process.env.BASE_URL}/success/${encodeURIComponent(coupleName)}-${encodeURIComponent(uniqueHash)}`;

    let promotionCodeId = null;
    let normalizedPromoCode = '';
    let appliedDiscountCents = 0;
    let discountMetadata = null;
    let unitAmount = product.price;

    if (promoCode) {
      let localCoupon = null;

      try {
        localCoupon = await db.getRecord('coupons', { code: normalizedInputCode });
      } catch (couponLookupError) {
        logger.error('Erro ao consultar cupom local.', {
          requestId: req.requestId,
          promoCode,
          error: couponLookupError.message
        });
        return res.status(500).json({ error: 'Não foi possível validar o código promocional. Tente novamente em instantes.' });
      }

      if (localCoupon) {
        const parseDateOnly = (value) => {
          if (!value) {
            return null;
          }

          if (value instanceof Date) {
            return new Date(value.getTime());
          }

          const isoValue = typeof value === 'string' && value.length === 10 ? `${value}T00:00:00Z` : value;
          const parsed = new Date(isoValue);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const now = new Date();
        const startDateLimit = parseDateOnly(localCoupon.start_date);
        const endDateLimit = parseDateOnly(localCoupon.end_date);

        const normalizeToStartOfDayUtc = value => {
          if (!value) {
            return null;
          }

          const copy = new Date(value.getTime());
          copy.setUTCHours(0, 0, 0, 0);
          return copy;
        };

        const normalizeToEndOfDayUtc = value => {
          if (!value) {
            return null;
          }

          const copy = new Date(value.getTime());
          copy.setUTCHours(23, 59, 59, 999);
          return copy;
        };

        const startBoundary = normalizeToStartOfDayUtc(startDateLimit);
        const endBoundary = normalizeToEndOfDayUtc(endDateLimit);
        const discountValue = Number(localCoupon.discount_value);
        const usageLimit = localCoupon.usage_limit;
        const usedCount = localCoupon.used_count || 0;

        const isInactive = localCoupon.active !== 1;
        const isBeforeStart = startBoundary && startBoundary > now;
        const isAfterEnd = endBoundary && endBoundary < now;
        const exceededUsage = usageLimit !== null && usageLimit !== undefined && usedCount >= usageLimit;
        const invalidDiscountValue = Number.isNaN(discountValue) || discountValue <= 0;

        if (isInactive || isBeforeStart || isAfterEnd || exceededUsage || invalidDiscountValue) {
          logger.warn('Código promocional inválido ou expirado.', {
            requestId: req.requestId,
            promoCode,
            couponId: localCoupon.id,
            reasons: {
              isInactive,
              isBeforeStart,
              isAfterEnd,
              exceededUsage,
              invalidDiscountValue
            }
          });
          return res.status(400).json({ error: 'Código promocional inválido ou expirado.' });
        }

        if (localCoupon.discount_type === 'percentual') {
          appliedDiscountCents = Math.round(product.price * (discountValue / 100));
        } else {
          appliedDiscountCents = Math.round(discountValue * 100);
        }

        if (appliedDiscountCents <= 0) {
          logger.warn('Valor de desconto calculado é inválido.', {
            requestId: req.requestId,
            promoCode,
            couponId: localCoupon.id,
            discountValue
          });
          return res.status(400).json({ error: 'Código promocional inválido ou expirado.' });
        }

        if (appliedDiscountCents >= product.price) {
          logger.warn('Desconto excede o valor do plano.', {
            requestId: req.requestId,
            promoCode,
            couponId: localCoupon.id,
            appliedDiscountCents,
            productPrice: product.price
          });
          return res.status(400).json({ error: 'O desconto aplicado excede o valor do plano selecionado.' });
        }

        unitAmount = product.price - appliedDiscountCents;
        normalizedPromoCode = normalizedInputCode;
        discountMetadata = {
          couponId: String(localCoupon.id),
          discountType: localCoupon.discount_type,
          discountValue: discountValue.toString(),
          discountAppliedInCents: String(appliedDiscountCents)
        };

        logger.info('Cupom interno aplicado com sucesso.', {
          requestId: req.requestId,
          couponId: localCoupon.id,
          code: normalizedPromoCode,
          discountAppliedInCents: appliedDiscountCents
        });
      } else {
        try {
          const promotionCodes = await stripe.promotionCodes.list({
            code: normalizedInputCode,
            active: true,
            limit: 1
          });

          if (!promotionCodes.data.length) {
            logger.warn('Código promocional inválido ou expirado.', {
              requestId: req.requestId,
              promoCode
            });
            return res.status(400).json({ error: 'Código promocional inválido ou expirado.' });
          }

          promotionCodeId = promotionCodes.data[0].id;
          normalizedPromoCode = promotionCodes.data[0].code;

          logger.info('Código promocional aplicado com sucesso.', {
            requestId: req.requestId,
            promotionCodeId,
            code: normalizedPromoCode
          });
        } catch (promoError) {
          logger.error('Erro ao validar código promocional.', {
            requestId: req.requestId,
            promoCode,
            error: promoError.message
          });
          return res.status(500).json({ error: 'Não foi possível validar o código promocional. Tente novamente em instantes.' });
        }
      }
    }

    const sessionParams = {
      payment_method_types: ['card', 'boleto'],
      line_items: [{
        price_data: {
          currency: 'brl',
          product_data: { name: product.name },
          unit_amount: unitAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      allow_promotion_codes: true,
      success_url: purchaseLink,
      cancel_url: `${process.env.BASE_URL}/`,
      payment_method_options: {
        boleto: {
          expires_after_days: 5,
        },
      },
      metadata: {
        requestId: req.requestId,
      }
    };

    if (promotionCodeId) {
      sessionParams.discounts = [{ promotion_code: promotionCodeId }];
    }

    if (normalizedPromoCode) {
      sessionParams.metadata.promoCode = normalizedPromoCode;
    }

    if (discountMetadata) {
      sessionParams.metadata.originalAmountInCents = String(product.price);
      Object.assign(sessionParams.metadata, discountMetadata, { discountSource: 'internal' });
    }

    // Criar a sessão no Stripe
    const session = await stripe.checkout.sessions.create(sessionParams);

    logger.info('Sessão de checkout criada.', {
      requestId: req.requestId,
      sessionId: session.id,
      promotionCodeId: promotionCodeId || null,
      metadata: session.metadata
    });

    // Salvar a compra no banco de dados e garantir que o ID da compra seja retornado
    logger.info('Iniciando salvamento da compra.', { requestId: req.requestId });

    const purchase = await db.createRecord('purchases', {
      couple_name: coupleName,
      plan_id: planId,
      session_id: session.id,
      start_date: startDate,
      unique_hash: uniqueHash,
      purchase_link: purchaseLink
    });

    if (!purchase || !purchase.id) {
      throw new Error("Falha ao inserir a compra no banco de dados. ID não retornado.");
    }

    logger.info('Compra salva com sucesso.', {
      requestId: req.requestId,
      purchaseId: purchase.id
    });

    // Verificar se a imagem foi enviada
    if (photoFile) {
      const originalImageUrl = `/media/${photoFile.filename}`; // URL da imagem original

      // Salvar a imagem original na tabela 'images'
      try {
        logger.info('Salvando imagem original no banco de dados.', {
          requestId: req.requestId,
          purchaseId: purchase.id
        });

        const imageRecord = await db.createRecord('images', {
          purchase_id: purchase.id,
          image_url: originalImageUrl
        });

        if (!imageRecord) {
          throw new Error("Falha ao salvar a imagem original no banco de dados.");
        }

        logger.info('Imagem original salva com sucesso.', {
          requestId: req.requestId,
          purchaseId: purchase.id,
          imageUrl: originalImageUrl
        });
      } catch (imageError) {
        logger.error('Erro ao salvar a imagem original no banco de dados.', {
          requestId: req.requestId,
          error: imageError.message
        });
        throw new Error("Erro ao salvar a imagem original no banco de dados.");
      }

      // Processar a imagem e adicionar o QR Code
      try {
        logger.info('Iniciando processamento da imagem.', {
          requestId: req.requestId,
          purchaseId: purchase.id
        });

        const qrUrl = `${process.env.BASE_URL}/pages/${encodeURIComponent(coupleName)}-${encodeURIComponent(uniqueHash)}`;

        // Primeiro, obtenha as dimensões da imagem para calcular o tamanho proporcional do QR code
        const imageMetadata = await sharp(photoFile.path).metadata();
        const measuredSides = [imageMetadata.width, imageMetadata.height].filter(
          (value) => typeof value === 'number' && value > 0
        );
        const minSide = measuredSides.length > 0 ? Math.min(...measuredSides) : 600;
        const qrCodeSize = Math.max(Math.round(minSide * 0.2), 120); // Tamanho proporcional ao menor lado da imagem (20%)

        const coloredQrCode = await QRCode.toBuffer(qrUrl, {
          width: qrCodeSize,
          color: {
            dark: '#ff3366',
            light: '#00000000'
          }
        });

        const qrPadding = Math.round(Math.max(qrCodeSize * 0.18, 18));
        const stylizedSize = Math.round(qrCodeSize + qrPadding * 2);
        const cornerRadius = Math.round(stylizedSize * 0.22);
        const gradientSvg = Buffer.from(
          `<svg width="${stylizedSize}" height="${stylizedSize}" viewBox="0 0 ${stylizedSize} ${stylizedSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="qrGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffe3ec" />
                <stop offset="100%" stop-color="#ffc1d9" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="${stylizedSize}" height="${stylizedSize}" rx="${cornerRadius}" fill="url(#qrGradient)" />
          </svg>`
        );

        const stylizedQrBuffer = await sharp(gradientSvg)
          .composite([
            {
              input: coloredQrCode,
              top: qrPadding,
              left: qrPadding
            }
          ])
          .png()
          .toBuffer();

        // Processar a imagem com QR Code e salvar em /media/edit
        const outputFilePath = `public/media/edit/processed-${photoFile.filename}`;
        await sharp(photoFile.path)
          .rotate() // Garantir a orientação correta da imagem
          .composite([
            {
              input: stylizedQrBuffer,
              gravity: 'southwest',
              dx: 40,
              dy: 40
            }
          ]) // Adicionar o QR code estilizado na posição inferior esquerda
          .toFile(outputFilePath);

        // Salvar a imagem com QR Code na tabela 'imagesEdit'
        await db.createRecord('imagesEdit', {
          purchase_id: purchase.id,
          image_url: `/media/edit/processed-${photoFile.filename}`
        });

        logger.info('Imagem com QR Code salva com sucesso.', {
          requestId: req.requestId,
          purchaseId: purchase.id
        });
      } catch (imageError) {
        logger.error('Erro ao processar a imagem com QR Code.', {
          requestId: req.requestId,
          error: imageError.message
        });
        throw new Error("Erro ao salvar a imagem com QR Code no banco de dados.");
      }
    } else {
      logger.warn('Nenhuma imagem enviada ou falha ao processar a imagem.', {
        requestId: req.requestId
      });
    }

    res.json({ id: session.id });
  } catch (error) {
    logger.error('Erro ao criar sessão de checkout.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).json({ error: "Erro ao criar sessão de checkout. Por favor, tente novamente." });
  }
});




// Webhook para receber eventos da Stripe
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verificar e construir o evento com a assinatura
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    logger.error('Erro de verificação de webhook.', {
      error: err.message
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processar diferentes tipos de eventos que você deseja capturar
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    logger.info('Pagamento realizado com sucesso.', { sessionId: session.id });
    // Atualizar o banco de dados com o status do pagamento, caso necessário
  } else if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    logger.info('Pagamento de boleto realizado com sucesso.', { invoiceId: invoice.id });
    // Atualizar o status de pagamento no banco de dados aqui
  }

  // Enviar resposta 200 para confirmar o recebimento do webhook
  res.status(200).json({ received: true });
});

// Rota de sucesso baseada na hash
app.get('/success/:coupleName-:hash', async (req, res) => {
  const { coupleName, hash } = req.params;

  try {
    // Buscar os dados da compra pelo nome do casal e pela hash única
    const purchase = await db.getRecord('purchases', { couple_name: coupleName, unique_hash: hash });

    if (!purchase) {
      logger.warn('Compra não encontrada durante acesso à página de sucesso.', {
        requestId: req.requestId,
        coupleName,
        hash
      });
      return res.status(404).send('Compra não encontrada.');
    }

    // Buscar a URL da imagem editada (com o QR code)
    const imageRecord = await db.getRecord('imagesEdit', { purchase_id: purchase.id });
    const qrImageUrl = imageRecord ? imageRecord.image_url : null;

    // Renderizar a página de sucesso com os dados da compra e a imagem editada
    res.render('success', {
      coupleName: purchase.couple_name,
      planId: purchase.plan_id,
      startDate: purchase.start_date,
      uniqueHash: purchase.unique_hash,
      qrImageUrl: qrImageUrl, // Passando a URL da imagem para o template
      pageUrl: `/pages/${encodeURIComponent(purchase.couple_name)}-${encodeURIComponent(purchase.unique_hash)}`
    });
  } catch (error) {
    logger.error('Erro ao buscar os dados da compra para página de sucesso.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).send('Erro ao processar sua requisição.');
  }
});


// Rota para exibir a página personalizada com o nome do casal e a hash
app.get('/pages/:coupleName-:hash', async (req, res) => {
  const { coupleName, hash } = req.params;

  try {
    // Buscar os dados da compra
    const purchase = await db.getRecord('purchases', { couple_name: coupleName, unique_hash: hash });

    if (!purchase) {
      logger.warn('Página personalizada não encontrada.', {
        requestId: req.requestId,
        coupleName,
        hash
      });
      return res.status(404).send('Página personalizada não encontrada.');
    }

    // Buscar a URL da imagem associada ao purchase_id
    const imageRecord = await db.getRecord('images', { purchase_id: purchase.id });
    const imageUrl = imageRecord ? imageRecord.image_url : null;

    // Renderizar a página personalizada
    res.render('couplePage', {
      coupleName: purchase.couple_name,
      startDate: purchase.start_date,
      planId: purchase.plan_id,
      imageUrl: imageUrl // Passar a URL da imagem para o template
    });
  } catch (error) {
    logger.error('Erro ao buscar dados para página personalizada.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).send('Erro ao processar sua requisição.');
  }
});

// Rota de cancelamento
app.get('/cancel', (req, res) => {
  try {
    res.send('Pagamento cancelado.');
  } catch (error) {
    logger.error('Erro ao carregar a página de cancelamento.', {
      requestId: req.requestId,
      error: error.message
    });
    res.status(500).send('Erro ao processar sua requisição.');
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 7500;
if (require.main === module) {
  app.listen(PORT, () => {
    try {
      logger.info('Servidor rodando.', { port: PORT });
    } catch (error) {
      logger.error('Erro ao iniciar o servidor.', { error: error.message });
    }
  });
}

module.exports = app;
