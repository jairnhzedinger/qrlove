# Guia de Contribuição para o QRLove

Bem-vinda(o) ao projeto **QRLove**! Este documento descreve a visão do produto, os principais componentes técnicos e as convenções que devem ser seguidas ao contribuir com este repositório. Leia-o completamente antes de iniciar qualquer alteração.

---

## Visão do Produto

QRLove é um serviço que permite a casais criarem uma página comemorativa personalizada. O fluxo principal inclui:

1. **Checkout Stripe** – o casal escolhe um plano e efetua o pagamento via cartão ou boleto.
2. **Upload de Foto** – uma foto do casal é enviada; geramos uma versão editada com QR Code.
3. **Landing Personalizada** – a página `/pages/:coupleName-:hash` mostra dados do relacionamento e a imagem original.
4. **Página de Sucesso** – após o pagamento, `/success/:coupleName-:hash` exibe detalhes da compra e a arte com QR Code.

Componentes-chave:
- `app.js`: servidor Express com rotas, integração Stripe, upload (multer), manipulação de imagem (sharp) e geração de QR Code.
- `db.js`: camada de acesso MySQL (mysql2) com utilitários CRUD simples.
- `views/*.ejs`: templates EJS renderizados pelo Express.
- `public/media`: armazenamento de imagens enviadas e processadas.

---

## Convenções de Código

- **JavaScript/Node.js**
  - Use `const`/`let` conforme apropriado; evite `var`.
  - Prefira funções assíncronas `async/await` e sempre trate exceções com `try/catch` envolvendo chamadas IO críticas.
  - Centralize strings literal reutilizáveis ou chaves mágicas em constantes no topo do módulo.
  - Não adicionar blocos `try/catch` em torno de imports (`require`), conforme guideline global.
  - Utilize `module.exports` / `require` (CommonJS) para manter consistência com o código existente.

- **Formatação**
  - Siga o estilo de 2 espaços por indentação em `.js` e `.ejs`.
  - Quebre linhas longas > 100 caracteres quando possível.
  - Ao adicionar novos templates, mantenha HTML semanticamente correto (use `section`, `article`, `header`, etc. quando fizer sentido) e sempre inclua `<meta charset="UTF-8">`.

- **EJS/Frontend**
  - Evite JavaScript inline quando puder extrair para `<script>` ao final do `body`.
  - Para novos assets, coloque-os em `public/` e referencie com caminhos relativos iniciando em `/`.

- **Banco de Dados**
  - Utilize as helpers de `db.js`. Se precisar de uma operação mais complexa, adicione um método novo no módulo com logs claros.
  - Toda migration ou alteração de schema deve ser documentada em `docs/schema.md` (crie o arquivo se necessário).

---

## Boas Práticas Operacionais

- Configure um arquivo `.env` local com as chaves `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `BASE_URL`, e credenciais `DB_*`.
- Para desenvolvimento local execute `npm install` e depois `node app.js`. Prefira usar `npm run dev` (com nodemon) se adicionar ao `package.json`.
- Sempre verifique logs de erro no terminal; mensagens significativas devem permanecer em português para consistência.

---

## Backlog de Melhorias (prioridade sugerida)

1. **Validação Robusta de Formulário**
   - Garantir que `coupleName`, `startDate` e upload de foto estejam presentes antes de criar a sessão Stripe.
   - Retornar erros amigáveis para o frontend e tratar exibições no template.

2. **Armazenamento Seguro de Arquivos**
   - Validar tipo MIME/extensão das imagens e impor limites de tamanho.
   - Considerar mover assets processados para um provedor externo (S3, Cloudinary) e guardar apenas URLs.

3. **Melhorias de UX/UI**
   - Revisar `views/index.ejs` para componentes responsivos (usar CSS grid/flex com breakpoints).
   - Incluir pré-visualização da foto e feedback visual do estado do upload.

4. **Observabilidade e Monitoramento**
   - Padronizar logs (ex.: `console.info`, `console.error`) com IDs de requisição.
   - Adicionar tratamento para eventos Stripe adicionais (falhas, disputas).

5. **Testes Automatizados**
   - Introduzir testes unitários para `db.js` (mockando MySQL) e integração de rotas críticas com Supertest.
   - Configurar GitHub Actions com lint + testes.

Documente qualquer decisão arquitetural relevante em um arquivo `docs/decisions/` com data no formato `YYYY-MM-DD-<titulo>.md`.

---

## Como Propor Alterações

1. Abra uma branch a partir da `main` seguindo o padrão `feature/<descricao-curta>` ou `fix/<descricao-curta>`.
2. Escreva commits pequenos e descritivos em português.
3. Ao abrir PR, forneça resumo das mudanças, instruções de teste e evidências (logs, prints) quando pertinente.
4. Antes de solicitar review, execute os testes existentes e confirme que o servidor inicia sem erros.

Obrigado por contribuir para tornar o QRLove ainda mais especial! 💖
