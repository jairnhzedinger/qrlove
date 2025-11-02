const express = require('express');
const Stripe = require('stripe');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto'); // Para gerar a hash única
const multer = require('multer'); // Biblioteca para upload de arquivos
const db = require('./db'); // Importar o módulo db.js
const bodyParser = require('body-parser');
const QRCode = require('qrcode'); // Biblioteca para gerar QR Codes
const sharp = require('sharp'); // Biblioteca para manipulação de imagens

// Carregar variáveis de ambiente
dotenv.config();

// Inicializar Stripe com a chave secreta
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

// Configurações
app.use(express.static(path.join(__dirname, 'public'))); // Servir arquivos estáticos (CSS, imagens)
app.set('view engine', 'ejs'); // Configurar EJS como engine de templates
app.use(express.json()); // Permitir parsing de JSON

// Middleware para tratar payloads de Webhook em formato raw
app.use(bodyParser.raw({ type: 'application/json' }));

// Logging básico
console.log("Servidor iniciado.");

// Enviar a chave pública para o frontend
app.get('/config', (req, res) => {
  try {
    res.json({ publicKey: process.env.STRIPE_PUBLISHABLE_KEY });
  } catch (error) {
    console.error("Erro ao enviar chave pública:", error.message);
    res.status(500).json({ error: 'Erro ao obter a chave pública.' });
  }
});

// Função para gerar uma hash única
function generateUniqueHash() {
  return crypto.randomBytes(16).toString('hex');
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
    console.log("Requisição para /");
    res.render('index');
  } catch (error) {
    console.error("Erro ao renderizar a página inicial:", error.message);
    res.status(500).send("Erro ao carregar a página.");
  }
});

// Endpoint de criação de sessão de checkout, incluindo upload da imagem
app.post('/create-checkout-session', upload.single('photo'), async (req, res) => {
  try {
    console.log("Requisição para /create-checkout-session");
    const { coupleName, planId, startDate } = req.body; // Dados do formulário
    const photoFile = req.file; // Arquivo da imagem enviada

    console.log("Dados recebidos:", { coupleName, planId, startDate });

    const products = [
      { id: 1, name: 'Anual', price: 1990 },
      { id: 2, name: 'Lifetime', price: 4990 },
    ];

    const product = products.find(p => p.id === Number(planId));

    if (!product) {
      console.error(`Plano não encontrado com ID ${planId}`);
      return res.status(404).json({ error: 'Plano não encontrado' });
    }

    // Gerar a hash única
    const uniqueHash = generateUniqueHash();

    // Criar a URL de sucesso com o coupleName e a hash codificados
    const purchaseLink = `${process.env.BASE_URL}/success/${encodeURIComponent(coupleName)}-${encodeURIComponent(uniqueHash)}`;

    // Criar a sessão no Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'boleto'],
      line_items: [{
        price_data: {
          currency: 'brl',
          product_data: { name: product.name },
          unit_amount: product.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: purchaseLink,
      cancel_url: `${process.env.BASE_URL}/`,
      payment_method_options: {
        boleto: {
          expires_after_days: 5,
        },
      },
    });

    console.log("Sessão de checkout criada:", session.id);

    // Salvar a compra no banco de dados e garantir que o ID da compra seja retornado
    console.log("Iniciando o salvamento da compra no banco de dados...");

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

    console.log(`Compra salva com sucesso. ID da compra: ${purchase.id}`);

    // Verificar se a imagem foi enviada
    if (photoFile) {
      const originalImageUrl = `/media/${photoFile.filename}`; // URL da imagem original

      // Salvar a imagem original na tabela 'images'
      try {
        console.log("Salvando imagem original no banco de dados...");

        const imageRecord = await db.createRecord('images', {
          purchase_id: purchase.id,
          image_url: originalImageUrl
        });

        if (!imageRecord) {
          throw new Error("Falha ao salvar a imagem original no banco de dados.");
        }

        console.log(`Imagem original salva com sucesso na tabela 'images' para a compra ID: ${purchase.id}, URL: ${originalImageUrl}`);
      } catch (imageError) {
        console.error("Erro ao salvar a imagem original no banco de dados:", imageError.message);
        throw new Error("Erro ao salvar a imagem original no banco de dados.");
      }

      // Processar a imagem e adicionar o QR Code
      try {
        console.log("Iniciando processamento da imagem com QR Code...");

        const qrUrl = `${process.env.BASE_URL}/pages/${encodeURIComponent(coupleName)}-${encodeURIComponent(uniqueHash)}`;

        // Primeiro, obtenha as dimensões da imagem para calcular o tamanho proporcional do QR code
        const imageMetadata = await sharp(photoFile.path).metadata();
        const qrCodeSize = Math.min(imageMetadata.width, imageMetadata.height) * 0.2; // Tamanho proporcional ao menor lado da imagem (20%)

        const qrCodeBuffer = await QRCode.toBuffer(qrUrl, { width: qrCodeSize });

        // Processar a imagem com QR Code e salvar em /media/edit
        const outputFilePath = `public/media/edit/processed-${photoFile.filename}`;
        await sharp(photoFile.path)
          .rotate() // Garantir a orientação correta da imagem
          .composite([{ input: qrCodeBuffer, gravity: 'southwest' }]) // Adicionar o QR code na posição inferior esquerda
          .toFile(outputFilePath);

        // Salvar a imagem com QR Code na tabela 'imagesEdit'
        await db.createRecord('imagesEdit', {
          purchase_id: purchase.id,
          image_url: `/media/edit/processed-${photoFile.filename}`
        });

        console.log(`Imagem com QR Code salva com sucesso na tabela 'imagesEdit' para a compra ID: ${purchase.id}`);
      } catch (imageError) {
        console.error("Erro ao salvar a imagem com QR Code no banco de dados:", imageError.message);
        throw new Error("Erro ao salvar a imagem com QR Code no banco de dados.");
      }
    } else {
      console.warn("Nenhuma imagem enviada ou falha ao processar a imagem.");
    }

    res.json({ id: session.id });
  } catch (error) {
    console.error("Erro ao criar sessão de checkout:", error.message);
    res.status(500).json({ error: "Erro ao criar sessão de checkout. Por favor, tente novamente." });
  }
});




// Webhook para receber eventos da Stripe
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verificar e construir o evento com a assinatura
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Erro de verificação de webhook: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Processar diferentes tipos de eventos que você deseja capturar
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`Pagamento realizado com sucesso para sessão ${session.id}`);
    // Atualizar o banco de dados com o status do pagamento, caso necessário
  } else if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object;
    console.log(`Pagamento de boleto realizado com sucesso para invoice ${invoice.id}`);
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
      qrImageUrl: qrImageUrl // Passando a URL da imagem para o template
    });
  } catch (error) {
    console.error("Erro ao buscar os dados da compra:", error.message);
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
    console.error("Erro ao buscar os dados da compra:", error.message);
    res.status(500).send('Erro ao processar sua requisição.');
  }
});

// Rota de cancelamento
app.get('/cancel', (req, res) => {
  try {
    res.send('Pagamento cancelado.');
  } catch (error) {
    console.error("Erro ao carregar a página de cancelamento:", error.message);
    res.status(500).send('Erro ao processar sua requisição.');
  }
});

// Iniciar o servidor
const PORT = process.env.PORT || 7500;
app.listen(PORT, () => {
  try {
    console.log(`Servidor rodando na porta ${PORT}`);
  } catch (error) {
    console.error("Erro ao iniciar o servidor:", error.message);
  }
});
