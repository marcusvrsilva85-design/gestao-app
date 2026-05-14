# 🗂️ Gestão Pessoal App

Sistema multi-usuário de gestão pessoal integrado — financeiro, saúde, treino e nutrição.

---

## 📋 Sobre o projeto

O **Gestão Pessoal App** é uma API backend Node.js que centraliza o controle de:

- 💰 **Financeiro** — contas, lançamentos, transferências, faturas de cartão e importação via Gmail
- 🏥 **Saúde** — biometria corporal, exames laboratoriais e alertas
- 🚴 **Treino** — ciclos de trabalho/folga, planos por dia e registro de sessões
- 🥗 **Nutrição** — diário alimentar por refeição com macros
- 🎯 **Metas** — metas financeiras, de saúde e treino por usuário
- 🔔 **Notificações** — alertas via app, Telegram e e-mail

Cada usuário tem seus dados 100% isolados via **Row Level Security (RLS)** no PostgreSQL.

---

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js ≥ 20 |
| Framework | Express 4 |
| Banco de dados | PostgreSQL (Supabase) |
| Linguagens | JavaScript + TypeScript |
| Autenticação | JWT + bcrypt |
| E-mail | Nodemailer / Resend |
| Agendamento | node-cron |
| Deploy | Railway |

---

## 📁 Estrutura de pastas

```
gestao-app/
├── src/                  # Código-fonte principal
│   └── index.js          # Entrypoint da aplicação
├── dashboard/            # Arquivos do painel web
├── mobile/               # Arquivos da versão mobile
├── 01_setup_banco.sql    # Script completo de criação do banco
├── env.example           # Variáveis de ambiente (modelo)
├── railway.toml          # Configuração de deploy no Railway
├── package.json
└── README.md
```

---

## ⚙️ Como rodar localmente

### Pré-requisitos

- Node.js 20+
- Conta no [Supabase](https://supabase.com) (PostgreSQL)
- npm ou yarn

### 1. Clone o repositório

```bash
git clone https://github.com/marcusvrsilva85-design/gestao-app.git
cd gestao-app
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

```bash
cp env.example .env
```

Edite o arquivo `.env` com suas credenciais (veja a seção abaixo).

### 4. Configure o banco de dados

No painel do Supabase, acesse **SQL Editor** e execute o arquivo `01_setup_banco.sql` bloco por bloco.

### 5. Inicie o servidor

```bash
# Desenvolvimento (com hot reload)
npm run dev

# Produção
npm start
```

---

## 🔑 Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto com base no `env.example`:

```env
# Banco de dados
DATABASE_URL=postgresql://usuario:senha@host:5432/banco

# Autenticação
JWT_SECRET=sua_chave_secreta_aqui
JWT_EXPIRES_IN=7d

# Servidor
PORT=3000
NODE_ENV=development

# E-mail (Resend ou Nodemailer)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=noreply@seudominio.com

# Telegram (opcional)
TELEGRAM_BOT_TOKEN=seu_token_aqui

# Google Gmail (opcional — importação automática)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

> ⚠️ **Nunca suba o arquivo `.env` para o repositório.** Ele já está no `.gitignore`.

---

## 🗄️ Banco de dados

O arquivo `01_setup_banco.sql` cria todas as tabelas, índices, views, triggers e políticas RLS:

| # | Tabela / Objeto | Descrição |
|---|---|---|
| 1 | `usuarios` | Cadastro de usuários |
| 2 | `contas` | Contas e carteiras financeiras |
| 3 | `categorias` | Categorias globais + personalizadas |
| 4 | `lancamentos` | Transações financeiras |
| 5 | `faturas` | Faturas de cartão de crédito |
| 6 | `saude_biometria` | Medições corporais |
| 7 | `saude_exames` | Exames laboratoriais |
| 8 | `treino_ciclo_config` | Configuração do ciclo de treino |
| 9 | `treino_plano` | Plano por dia do ciclo |
| 10 | `treino_sessoes` | Sessões realizadas |
| 11 | `nutricao_diario` | Diário alimentar |
| 12 | `metas` | Metas do usuário |
| 13 | `notificacoes` | Alertas e notificações |
| 14 | `importacoes_gmail` | Log de importações via Gmail |
| 15 | `push_tokens` | Tokens de notificação push |
| — | `v_saldos` | View: saldo atual por conta |
| — | `v_faturas_pendentes` | View: faturas com alerta por dias |
| — | `v_biometria_atual` | View: última medição por usuário |
| — | `registrar_transferencia()` | Função: transferência atômica |

---

## 🔒 Segurança

- Senhas armazenadas com **bcrypt** (nunca em texto puro)
- Autenticação via **JWT** com expiração configurável
- **Rate limiting** em todas as rotas com `express-rate-limit`
- **RLS (Row Level Security)** no PostgreSQL — cada usuário só acessa seus próprios dados
- Variáveis sensíveis isoladas em `.env` (fora do repositório)

---

## 🚀 Deploy

O projeto está configurado para deploy automático no **Railway** via `railway.toml`.

A cada push na branch `main`, o Railway realiza o deploy automaticamente.

---

## 📌 Roadmap

- [ ] Testes automatizados (Jest)
- [ ] Migração completa para TypeScript
- [ ] GitHub Actions (CI/CD)
- [ ] Documentação da API (Swagger/OpenAPI)
- [ ] Integração com Galaxy Watch (biometria automática)
- [ ] Bot Telegram completo

---

## 📄 Licença

Projeto privado — todos os direitos reservados.