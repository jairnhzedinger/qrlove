# Esquema do Banco de Dados

Este documento descreve as tabelas utilizadas pelo QRLove após a execução de `node migrations.js`.

## admins

Tabela responsável por armazenar credenciais de acesso ao dashboard administrativo.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| id | INT AUTO_INCREMENT PK | Identificador do admin. |
| email | VARCHAR(255) UNIQUE | E-mail usado no login. |
| password_hash | VARCHAR(255) | Senha criptografada com bcrypt. |
| name | VARCHAR(255) | Nome de exibição opcional. |
| created_at | TIMESTAMP | Data de criação. |
| updated_at | TIMESTAMP | Data da última atualização. |

## partners

Armazena parceiros comerciais e fornecedores relacionados às experiências dos casais.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| id | INT AUTO_INCREMENT PK | Identificador do parceiro. |
| name | VARCHAR(255) | Nome fantasia ou razão social. |
| email | VARCHAR(255) | Contato principal. |
| phone | VARCHAR(50) | Telefone ou WhatsApp. |
| status | ENUM('ativo','inativo','pendente') | Estado do relacionamento comercial. |
| notes | TEXT | Observações internas. |
| created_at | TIMESTAMP | Data de cadastro. |
| updated_at | TIMESTAMP | Última atualização. |

## coupons

Tabela com cupons internos usados para promoções no checkout.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| id | INT AUTO_INCREMENT PK | Identificador do cupom. |
| code | VARCHAR(100) UNIQUE | Código aplicado no checkout. |
| description | TEXT | Resumo da campanha. |
| discount_type | ENUM('percentual','valor_fixo') | Tipo de desconto aplicado. |
| discount_value | DECIMAL(10,2) | Valor do desconto (percentual ou fixo). |
| usage_limit | INT | Limite máximo de usos. |
| used_count | INT | Número de utilizações registradas. |
| start_date | DATE | Início da validade. |
| end_date | DATE | Término da validade. |
| active | TINYINT(1) | Indica se o cupom pode ser utilizado. |
| partner_id | INT FK | Parceiro associado (opcional). |
| created_at | TIMESTAMP | Data de criação. |
| updated_at | TIMESTAMP | Última atualização. |

## financial_transactions

Registra movimentações financeiras relacionadas às vendas, comissões e despesas.

| Coluna | Tipo | Descrição |
| --- | --- | --- |
| id | INT AUTO_INCREMENT PK | Identificador da transação. |
| transaction_type | ENUM('entrada','saida') | Direção do fluxo financeiro. |
| amount | DECIMAL(12,2) | Valor financeiro da transação. |
| description | TEXT | Detalhes da movimentação. |
| reference | VARCHAR(255) | Referência externa (ex.: ID da venda). |
| occurred_at | DATE | Data da ocorrência. |
| created_at | TIMESTAMP | Data de lançamento. |
| updated_at | TIMESTAMP | Última atualização. |

