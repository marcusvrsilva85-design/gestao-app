// ============================================================
// GESTÃO PESSOAL — Backend multi-usuário
// Arquivo: src/index.js
// ============================================================

'use strict';
require('dotenv').config();
const nlp = require('./nlp');

const express   = require('express');
const { Pool }  = require('pg');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcrypt');
const jwt       = require('jsonwebtoken');
const cron      = require('node-cron');
const fetch     = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const app = express();

// Configuração para Railway (proxy reverso)
app.set('trust proxy', 1);
console.log('[Debug] trust proxy =', app.get('trust proxy'));
console.log('[Debug] arquivo carregado: src/index.js');
// Debug das variáveis do Strava
console.log('[Debug] STRAVA_CLIENT_ID:', process.env.STRAVA_CLIENT_ID ? 'OK' : 'AUSENTE');
console.log('[Debug] STRAVA_CLIENT_SECRET:', process.env.STRAVA_CLIENT_SECRET ? 'OK' : 'AUSENTE');

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-isso-em-producao';

// ─────────────────────────────────────────────
// BANCO DE DADOS
// ─────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
});
// ─────────────────────────────────────────────
// MIDDLEWARES GLOBAIS
// ─────────────────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting geral
app.use('/api', rateLimit({
  windowMs: 60_000, max: 300,
  message: { erro: 'Muitas requisições. Aguarde 1 minuto.' },
}));

// Rate limiting mais restrito para auth
app.use('/auth', rateLimit({
  windowMs: 15 * 60_000, max: 20,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' },
}));

// ─────────────────────────────────────────────
// MIDDLEWARE: AUTENTICAÇÃO JWT
// Extrai o user_id do token e injeta no req
// ─────────────────────────────────────────────
function autenticar(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ erro: 'Token não fornecido' });

  try {
    const token   = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId    = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

// Helper: query sempre filtrada pelo user_id corrente
async function query(sql, params = [], userId = null) {
  if (userId) {
    // Configura o contexto para RLS do Postgres
    const client = await db.connect();
    try {
      await client.query(`SET LOCAL app.user_id = '${userId}'`);
      const result = await client.query(sql, params);
      return result;
    } finally {
      client.release();
    }
  }
  return db.query(sql, params);
}

// ─────────────────────────────────────────────
// HELPERS: COMPETÊNCIA E FORMATAÇÃO
// ─────────────────────────────────────────────
function competenciaAtual() {
  const d = new Date();
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function formatarMoeda(v) {
  return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

// ─────────────────────────────────────────────
// ROTAS: AUTENTICAÇÃO
// ─────────────────────────────────────────────

// POST /auth/register — criar conta
app.post('/auth/register', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'nome, email e senha são obrigatórios' });
    if (senha.length < 6)
      return res.status(400).json({ erro: 'Senha deve ter mínimo 6 caracteres' });

    const senhaHash = await bcrypt.hash(senha, 12);
    const { rows } = await db.query(
      `INSERT INTO usuarios (nome, email, senha_hash)
       VALUES ($1, $2, $3) RETURNING id, nome, email, plano, criado_em`,
      [nome.trim(), email.toLowerCase().trim(), senhaHash]
    );

    const usuario = rows[0];
    const token = jwt.sign(
      { userId: usuario.id, email: usuario.email },
      JWT_SECRET, { expiresIn: '30d' }
    );

    res.status(201).json({ token, usuario });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ erro: 'E-mail já cadastrado' });
    console.error('[register]', err.message);
    res.status(500).json({ erro: 'Erro ao criar conta' });
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ erro: 'E-mail e senha são obrigatórios' });

    const { rows } = await db.query(
      'SELECT * FROM usuarios WHERE email=$1 AND ativo=true',
      [email.toLowerCase().trim()]
    );
    const usuario = rows[0];
    if (!usuario || !(await bcrypt.compare(senha, usuario.senha_hash)))
      return res.status(401).json({ erro: 'E-mail ou senha incorretos' });

    const token = jwt.sign(
      { userId: usuario.id, email: usuario.email },
      JWT_SECRET, { expiresIn: '30d' }
    );

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, plano: usuario.plano },
    });
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ erro: 'Erro ao fazer login' });
  }
});

// GET /auth/me
app.get('/auth/me', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, nome, email, plano, telegram_ativo, criado_em FROM usuarios WHERE id=$1',
    [req.userId]
  );
  res.json(rows[0]);
});

// PATCH /auth/telegram — conectar bot Telegram
app.patch('/auth/telegram', autenticar, async (req, res) => {
  const { chat_id } = req.body;
  if (!chat_id) return res.status(400).json({ erro: 'chat_id é obrigatório' });

  await db.query(
    'UPDATE usuarios SET telegram_chat_id=$1, telegram_ativo=true WHERE id=$2',
    [String(chat_id), req.userId]
  );
  res.json({ mensagem: 'Telegram conectado com sucesso' });
});

// ─────────────────────────────────────────────
// ROTAS: CONTAS
// ─────────────────────────────────────────────

app.get('/api/contas', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM contas WHERE user_id=$1 AND ativa=true ORDER BY nome',
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/contas', autenticar, async (req, res) => {
  const { nome, tipo, banco, cor_hex, saldo_inicial } = req.body;
  if (!nome || !tipo)
    return res.status(400).json({ erro: 'nome e tipo são obrigatórios' });

  try {
    const { rows } = await db.query(
      `INSERT INTO contas (user_id, nome, tipo, banco, cor_hex, saldo_inicial)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, nome, tipo, banco, cor_hex || 'CCCCCC', saldo_inicial || 0]
    );
    nlp.invalidarCache(req.userId); // forçar reload das contas no NLP
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ erro: 'Já existe uma conta com esse nome' });
    res.status(500).json({ erro: err.message });
  }
});

app.patch('/api/contas/:id', autenticar, async (req, res) => {
  const { nome, cor_hex, ativa } = req.body;
  const { rows } = await db.query(
    `UPDATE contas SET nome=COALESCE($1,nome), cor_hex=COALESCE($2,cor_hex),
     ativa=COALESCE($3,ativa) WHERE id=$4 AND user_id=$5 RETURNING *`,
    [nome, cor_hex, ativa, req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Conta não encontrada' });
  res.json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: SALDOS
// ─────────────────────────────────────────────

app.get('/api/saldos', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM v_saldos WHERE user_id=$1 ORDER BY nome',
    [req.userId]
  );
  res.json(rows);
});

// ─────────────────────────────────────────────
// ROTAS: LANÇAMENTOS
// ─────────────────────────────────────────────

app.get('/api/lancamentos', autenticar, async (req, res) => {
  const { competencia, conta, tipo, status, busca, limit = 50, offset = 0 } = req.query;

  let sql = `
    SELECT l.*, co.nome AS conta_origem_nome, co.cor_hex AS conta_origem_cor,
           cd.nome AS conta_destino_nome
    FROM lancamentos l
    LEFT JOIN contas co ON l.conta_origem_id = co.id
    LEFT JOIN contas cd ON l.conta_destino_id = cd.id
    WHERE l.user_id = $1
  `;
  const params = [req.userId];
  let p = 2;

  if (competencia) { sql += ` AND l.competencia=$${p++}`; params.push(competencia); }
  if (tipo)        { sql += ` AND l.tipo=$${p++}`;        params.push(tipo); }
  if (status)      { sql += ` AND l.status=$${p++}`;      params.push(status); }
  if (conta)       { sql += ` AND (l.conta_origem_id=$${p} OR l.conta_destino_id=$${p++})`; params.push(conta); }
  if (busca)       { sql += ` AND l.descricao ILIKE $${p++}`; params.push(`%${busca}%`); }

  sql += ` ORDER BY l.data DESC, l.criado_em DESC LIMIT $${p++} OFFSET $${p++}`;
  params.push(parseInt(limit), parseInt(offset));

  const { rows } = await db.query(sql, params);
  res.json(rows);
});

app.post('/api/lancamentos', autenticar, async (req, res) => {
  const {
    data, descricao, valor, tipo,
    conta_origem_id, conta_destino_id,
    categoria_nome, subcategoria, forma_pagamento,
    status = 'Pago', competencia, observacao,
  } = req.body;

  if (!data || !valor || !tipo || !conta_origem_id)
    return res.status(400).json({ erro: 'data, valor, tipo e conta_origem_id são obrigatórios' });

  // Verificar que a conta pertence ao usuário
  const { rows: [conta] } = await db.query(
    'SELECT id FROM contas WHERE id=$1 AND user_id=$2',
    [conta_origem_id, req.userId]
  );
  if (!conta) return res.status(403).json({ erro: 'Conta não pertence ao usuário' });

  if (tipo.includes('Transferência')) {
    if (!conta_destino_id)
      return res.status(400).json({ erro: 'Transferência requer conta_destino_id' });
    const { rows } = await db.query(
      'SELECT * FROM registrar_transferencia($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [req.userId, data, descricao, valor, conta_origem_id, conta_destino_id,
       forma_pagamento || 'Pix', competencia || competenciaAtual(), 'App']
    );
    return res.status(201).json({ mensagem: 'Transferência registrada', ids: rows[0] });
  }

  const { rows } = await db.query(
    `INSERT INTO lancamentos
      (user_id,data,descricao,valor,tipo,conta_origem_id,conta_destino_id,
       categoria_nome,subcategoria,forma_pagamento,status,competencia,fonte,observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'App',$13) RETURNING *`,
    [req.userId, data, descricao, valor, tipo, conta_origem_id,
     conta_destino_id || null, categoria_nome, subcategoria,
     forma_pagamento, status, competencia || competenciaAtual(), observacao]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/lancamentos/:id', autenticar, async (req, res) => {
  const { descricao, categoria_nome, status, observacao } = req.body;
  const { rows } = await db.query(
    `UPDATE lancamentos SET
       descricao=COALESCE($1,descricao),
       categoria_nome=COALESCE($2,categoria_nome),
       status=COALESCE($3,status),
       observacao=COALESCE($4,observacao)
     WHERE id=$5 AND user_id=$6 RETURNING *`,
    [descricao, categoria_nome, status, observacao, req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Lançamento não encontrado' });
  res.json(rows[0]);
});

app.delete('/api/lancamentos/:id', autenticar, async (req, res) => {
  const { rows: [lanc] } = await db.query(
    'SELECT transferencia_par_id FROM lancamentos WHERE id=$1 AND user_id=$2',
    [req.params.id, req.userId]
  );
  if (!lanc) return res.status(404).json({ erro: 'Lançamento não encontrado' });

  if (lanc.transferencia_par_id) {
    await db.query(
      'DELETE FROM lancamentos WHERE id=ANY($1) AND user_id=$2',
      [[req.params.id, lanc.transferencia_par_id], req.userId]
    );
    return res.json({ mensagem: 'Par de transferência removido' });
  }
  await db.query('DELETE FROM lancamentos WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
  res.json({ mensagem: 'Lançamento removido' });
});

// ─────────────────────────────────────────────
// ROTAS: FATURAS
// ─────────────────────────────────────────────

app.get('/api/faturas', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM v_faturas_pendentes WHERE user_id=$1',
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/faturas', autenticar, async (req, res) => {
  const { conta_id, descricao, valor_total, vencimento, mes_referencia, observacao } = req.body;
  if (!conta_id || !descricao || !valor_total || !vencimento)
    return res.status(400).json({ erro: 'conta_id, descricao, valor_total e vencimento são obrigatórios' });

  const { rows } = await db.query(
    `INSERT INTO faturas (user_id, conta_id, descricao, valor_total, vencimento, mes_referencia, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.userId, conta_id, descricao, valor_total, vencimento, mes_referencia, observacao]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/faturas/:id', autenticar, async (req, res) => {
  const { status, lancamento_pagamento_id } = req.body;
  const { rows } = await db.query(
    `UPDATE faturas SET status=$1, lancamento_pagamento_id=$2
     WHERE id=$3 AND user_id=$4 RETURNING *`,
    [status, lancamento_pagamento_id, req.params.id, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ erro: 'Fatura não encontrada' });
  res.json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: RESUMO / KPIs
// ─────────────────────────────────────────────

app.get('/api/resumo', autenticar, async (req, res) => {
  const comp = req.query.competencia || competenciaAtual();
  const [saldos, faturas, resumo, metas] = await Promise.all([
    db.query('SELECT * FROM v_saldos WHERE user_id=$1', [req.userId]),
    db.query('SELECT * FROM v_faturas_pendentes WHERE user_id=$1', [req.userId]),
    db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='Entrada' THEN valor END),0) AS total_entradas,
         COALESCE(SUM(CASE WHEN tipo='Saída' THEN valor END),0)   AS total_saidas,
         COUNT(*) AS qtd_lancamentos
       FROM lancamentos
       WHERE user_id=$1 AND competencia=$2 AND status='Pago'
         AND tipo NOT LIKE 'Transferência%'`,
      [req.userId, comp]
    ),
    db.query("SELECT * FROM metas WHERE user_id=$1 AND ativa=true", [req.userId]),
  ]);
  res.json({
    saldos:   saldos.rows,
    faturas:  faturas.rows,
    resumo:   resumo.rows[0],
    metas:    metas.rows,
    competencia: comp,
  });
});

app.get('/api/categorias', autenticar, async (req, res) => {
  // Retorna categorias padrão + categorias do usuário
  const { rows } = await db.query(
    'SELECT * FROM categorias WHERE user_id IS NULL OR user_id=$1 ORDER BY nome',
    [req.userId]
  );
  res.json(rows);
});

// ─────────────────────────────────────────────
// ROTAS: SAÚDE — BIOMETRIA
// ─────────────────────────────────────────────

app.get('/api/saude/biometria', autenticar, async (req, res) => {
  const { limit = 30 } = req.query;
  const { rows } = await db.query(
    'SELECT * FROM saude_biometria WHERE user_id=$1 ORDER BY data_medicao DESC LIMIT $2',
    [req.userId, limit]
  );
  res.json(rows);
});

app.post('/api/saude/biometria', autenticar, async (req, res) => {
  const {
    data_medicao, peso_kg, altura_cm, gordura_pct,
    musculo_kg, agua_pct, imc, tmb_kcal, fonte, observacao,
  } = req.body;

  if (!data_medicao)
    return res.status(400).json({ erro: 'data_medicao é obrigatória' });

  // Calcular IMC automaticamente se tiver peso e altura
  const imcCalc = (!imc && peso_kg && altura_cm)
    ? parseFloat((peso_kg / Math.pow(altura_cm / 100, 2)).toFixed(1))
    : imc;

  const { rows } = await db.query(
    `INSERT INTO saude_biometria
      (user_id, data_medicao, peso_kg, altura_cm, gordura_pct,
       musculo_kg, agua_pct, imc, tmb_kcal, fonte, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.userId, data_medicao, peso_kg, altura_cm, gordura_pct,
     musculo_kg, agua_pct, imcCalc, tmb_kcal, fonte || 'Manual', observacao]
  );
  res.status(201).json(rows[0]);
});

// GET /api/saude/biometria/atual — última medição
app.get('/api/saude/biometria/atual', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM v_biometria_atual WHERE user_id=$1',
    [req.userId]
  );
  res.json(rows[0] || null);
});

// ─────────────────────────────────────────────
// ROTAS: SAÚDE — EXAMES
// ─────────────────────────────────────────────

app.get('/api/saude/exames', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM saude_exames WHERE user_id=$1 ORDER BY data_exame DESC',
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/saude/exames', autenticar, async (req, res) => {
  const {
    data_exame, nome, resultado, valor_numerico, unidade,
    ref_min, ref_max, laboratorio, medico, observacao,
  } = req.body;

  if (!data_exame || !nome || !resultado)
    return res.status(400).json({ erro: 'data_exame, nome e resultado são obrigatórios' });

  // Calcular status_alerta automaticamente
  let status_alerta = 'normal';
  if (valor_numerico && ref_max && valor_numerico > ref_max) status_alerta = 'critico';
  else if (valor_numerico && ref_min && valor_numerico < ref_min) status_alerta = 'atencao';

  const { rows } = await db.query(
    `INSERT INTO saude_exames
      (user_id, data_exame, nome, resultado, valor_numerico, unidade,
       ref_min, ref_max, status_alerta, laboratorio, medico, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.userId, data_exame, nome, resultado, valor_numerico, unidade,
     ref_min, ref_max, status_alerta, laboratorio, medico, observacao]
  );
  res.status(201).json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: TREINO — CICLO E PLANO
// ─────────────────────────────────────────────

app.get('/api/treino/ciclo', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM treino_ciclo_config WHERE user_id=$1 AND ativo=true LIMIT 1',
    [req.userId]
  );
  res.json(rows[0] || null);
});

app.post('/api/treino/ciclo', autenticar, async (req, res) => {
  const { nome, dias_trabalho, dias_folga, data_inicio } = req.body;
  if (!dias_trabalho || !dias_folga || !data_inicio)
    return res.status(400).json({ erro: 'dias_trabalho, dias_folga e data_inicio são obrigatórios' });

  // Desativar ciclo anterior
  await db.query('UPDATE treino_ciclo_config SET ativo=false WHERE user_id=$1', [req.userId]);

  const { rows } = await db.query(
    `INSERT INTO treino_ciclo_config (user_id, nome, dias_trabalho, dias_folga, data_inicio)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.userId, nome || 'Meu Ciclo', dias_trabalho, dias_folga, data_inicio]
  );
  res.status(201).json(rows[0]);
});

app.get('/api/treino/plano', autenticar, async (req, res) => {
  const { rows } = await db.query(
    `SELECT tp.* FROM treino_plano tp
     JOIN treino_ciclo_config tc ON tp.ciclo_id = tc.id
     WHERE tc.user_id=$1 AND tc.ativo=true
     ORDER BY tp.dia_numero`,
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/treino/plano', autenticar, async (req, res) => {
  const { ciclo_id, dia_numero, tipo_dia, atividade, treino_nome,
          duracao_min, zona_treino, objetivo, notas_nutricao } = req.body;

  if (!ciclo_id || !dia_numero)
    return res.status(400).json({ erro: 'ciclo_id e dia_numero são obrigatórios' });

  const { rows } = await db.query(
    `INSERT INTO treino_plano
      (user_id, ciclo_id, dia_numero, tipo_dia, atividade, treino_nome,
       duracao_min, zona_treino, objetivo, notas_nutrição)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (ciclo_id, dia_numero) DO UPDATE SET
       tipo_dia=EXCLUDED.tipo_dia, atividade=EXCLUDED.atividade,
       treino_nome=EXCLUDED.treino_nome, duracao_min=EXCLUDED.duracao_min,
       zona_treino=EXCLUDED.zona_treino, objetivo=EXCLUDED.objetivo,
       notas_nutrição=EXCLUDED.notas_nutrição
     RETURNING *`,
    [req.userId, ciclo_id, dia_numero, tipo_dia, atividade, treino_nome,
     duracao_min, zona_treino, objetivo, notas_nutricao]
  );
  res.status(201).json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: TREINO — SESSÕES REGISTRADAS
// ─────────────────────────────────────────────

app.get('/api/treino/sessoes', autenticar, async (req, res) => {
  const { limit = 30 } = req.query;
  const { rows } = await db.query(
    'SELECT * FROM treino_sessoes WHERE user_id=$1 ORDER BY data_sessao DESC LIMIT $2',
    [req.userId, limit]
  );
  res.json(rows);
});

app.post('/api/treino/sessoes', autenticar, async (req, res) => {
  const {
    data_sessao, tipo, nome, duracao_min, calorias,
    fc_media, fc_max, zona_predominante, distancia_km, notas, humor,
  } = req.body;

  if (!data_sessao || !tipo)
    return res.status(400).json({ erro: 'data_sessao e tipo são obrigatórios' });

  const { rows } = await db.query(
    `INSERT INTO treino_sessoes
      (user_id, data_sessao, tipo, nome, duracao_min, calorias,
       fc_media, fc_max, zona_predominante, distancia_km, notas, humor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.userId, data_sessao, tipo, nome, duracao_min, calorias,
     fc_media, fc_max, zona_predominante, distancia_km, notas, humor]
  );
  res.status(201).json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: NUTRIÇÃO
// ─────────────────────────────────────────────

app.get('/api/nutricao', autenticar, async (req, res) => {
  const { data } = req.query;
  const filtroData = data || new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    `SELECT * FROM nutricao_diario
     WHERE user_id=$1 AND data_registro=$2
     ORDER BY CASE refeicao
       WHEN 'Café da Manhã' THEN 1 WHEN 'Lanche' THEN 2
       WHEN 'Almoço' THEN 3 WHEN 'Pré-Treino' THEN 4
       WHEN 'Pós-Treino' THEN 5 WHEN 'Jantar' THEN 6
       WHEN 'Ceia' THEN 7 ELSE 8 END`,
    [req.userId, filtroData]
  );
  res.json(rows);
});

app.post('/api/nutricao', autenticar, async (req, res) => {
  const {
    data_registro, refeicao, descricao, calorias_kcal,
    proteina_g, carboidrato_g, gordura_g, fibra_g, agua_ml,
  } = req.body;

  if (!data_registro || !refeicao)
    return res.status(400).json({ erro: 'data_registro e refeicao são obrigatórios' });

  const { rows } = await db.query(
    `INSERT INTO nutricao_diario
      (user_id, data_registro, refeicao, descricao, calorias_kcal,
       proteina_g, carboidrato_g, gordura_g, fibra_g, agua_ml)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.userId, data_registro, refeicao, descricao, calorias_kcal,
     proteina_g, carboidrato_g, gordura_g, fibra_g, agua_ml]
  );
  res.status(201).json(rows[0]);
});

// ─────────────────────────────────────────────
// ROTAS: METAS
// ─────────────────────────────────────────────

app.get('/api/metas', autenticar, async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM metas WHERE user_id=$1 AND ativa=true ORDER BY modulo, nome",
    [req.userId]
  );
  res.json(rows);
});

app.post('/api/metas', autenticar, async (req, res) => {
  const { modulo, nome, valor_meta, unidade, data_limite } = req.body;
  if (!modulo || !nome)
    return res.status(400).json({ erro: 'modulo e nome são obrigatórios' });

  const { rows } = await db.query(
    `INSERT INTO metas (user_id, modulo, nome, valor_meta, unidade, data_limite)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.userId, modulo, nome, valor_meta, unidade, data_limite]
  );
  res.status(201).json(rows[0]);
});

app.delete('/api/metas/:id', autenticar, async (req, res) => {
  await db.query(
    'UPDATE metas SET ativa=false WHERE id=$1 AND user_id=$2',
    [req.params.id, req.userId]
  );
  res.json({ mensagem: 'Meta removida' });
});

// ─────────────────────────────────────────────
// WEBHOOK TELEGRAM — multi-usuário
// Identifica o usuário pelo telegram_chat_id
// ─────────────────────────────────────────────

app.post('/webhook/telegram', async (req, res) => {
  res.sendStatus(200); // Confirmar antes de processar

  try {
    const { message } = req.body;
    if (!message?.text) return;

    const chatId = String(message.chat.id);
    const texto  = message.text.trim();

    // Buscar usuário pelo chat_id
    const { rows: [usuario] } = await db.query(
      'SELECT id, nome FROM usuarios WHERE telegram_chat_id=$1 AND telegram_ativo=true AND ativo=true',
      [chatId]
    );

    // Usuário não cadastrado — instruir como conectar
    if (!usuario) {
      await enviarTelegram(chatId,
        '👋 Olá! Para usar o bot, acesse o app, vá em Configurações → Telegram e conecte sua conta.'
      );
      return;
    }

    await processarComandoTelegram(chatId, usuario.id, usuario.nome, texto);
  } catch (err) {
    console.error('[Webhook Telegram]', err.message);
  }
});

async function processarComandoTelegram(chatId, userId, nomeUsuario, texto) {
  const t = texto.toLowerCase().trim();

  if (t === '/saldo' || t === 'saldo') {
    const { rows } = await db.query(
      'SELECT * FROM v_saldos WHERE user_id=$1', [userId]
    );
    const linhas = rows
      .filter(s => s.tipo !== 'Milhas')
      .map(s => {
        const v = parseFloat(s.saldo_atual);
        const emoji = v < 0 ? '🔴' : v < 50 ? '⚠️' : '✅';
        return `${emoji} <b>${s.nome}</b>: ${formatarMoeda(v)}`;
      });
    const total = rows
      .filter(s => s.tipo !== 'Milhas')
      .reduce((a, b) => a + parseFloat(b.saldo_atual), 0);
    await enviarTelegram(chatId, [
      `💰 <b>SALDOS — ${nomeUsuario}</b>`, '',
      ...linhas, '',
      `<b>Total: ${formatarMoeda(total)}</b>`,
    ].join('\n'));
    return;
  }

  if (t === '/faturas' || t === 'faturas') {
    const { rows } = await db.query(
      'SELECT * FROM v_faturas_pendentes WHERE user_id=$1', [userId]
    );
    if (!rows.length) { await enviarTelegram(chatId, '✅ Nenhuma fatura pendente!'); return; }
    const linhas = rows.map(f =>
      `${f.alerta === 'urgente' ? '🚨' : '⚠️'} <b>${f.conta_nome}</b> — ${formatarMoeda(f.valor_total)} — ${f.vencimento}`
    );
    await enviarTelegram(chatId, ['💳 <b>FATURAS PENDENTES</b>', '', ...linhas].join('\n'));
    return;
  }

  if (t === '/mes' || t === 'resumo') {
    const { rows: [r] } = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo='Entrada' THEN valor END),0) AS ent,
         COALESCE(SUM(CASE WHEN tipo='Saída' THEN valor END),0) AS sai
       FROM lancamentos WHERE user_id=$1 AND competencia=$2 AND status='Pago'
         AND tipo NOT LIKE 'Transferência%'`,
      [userId, competenciaAtual()]
    );
    await enviarTelegram(chatId, [
      `📊 <b>RESUMO ${competenciaAtual()}</b>`, '',
      `✅ Entradas: ${formatarMoeda(r.ent)}`,
      `💸 Saídas:   ${formatarMoeda(r.sai)}`,
      `📈 Resultado: ${formatarMoeda(r.ent - r.sai)}`,
    ].join('\n'));
    return;
  }

  if (t === '/ajuda' || t === 'ajuda') {
    await enviarTelegram(chatId, [
      '🤖 <b>COMANDOS DISPONÍVEIS</b>', '',
      '<b>Registrar saída:</b>',
      '  paguei 50 de gasolina débito nubank',
      '  gastei 30 no mercado c6', '',
      '<b>Registrar entrada:</b>',
      '  recebi 2000 da raquel', '',
      '<b>Registrar transferência:</b>',
      '  transferi 500 da caixa para o nubank', '',
      '<b>Consultas:</b>',
      '  /saldo  /mes  /faturas  /ajuda',
    ].join('\n'));
    return;
  }

  // Parsear como lançamento financeiro com NLP dinâmico
  try {
    const parsed = await nlp.parsearMensagem(texto, db, userId);

    if (parsed.acao === 'erro') {
      await enviarTelegram(chatId,
        `❌ ${parsed.msg}\n\nDigite /ajuda para ver exemplos.`
      );
      return;
    }

    // Salvar no banco
    await nlp.salvarParsed(db, parsed, userId);

    // Confirmar para o usuário
    await enviarTelegram(chatId, nlp.formatarConfirmacao(parsed));

  } catch (err) {
    console.error('[NLP]', err.message);
    await enviarTelegram(chatId,
      '❌ Erro ao processar. Tente novamente ou use /ajuda.'
    );
  }
}

async function enviarTelegram(chatId, texto) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
    }
  );
}

// ─────────────────────────────────────────────
// CRON JOBS
// ─────────────────────────────────────────────

// Todo dia 08:00 — alertar usuários com faturas urgentes via Telegram
cron.schedule('0 8 * * *', async () => {
  try {
    const { rows } = await db.query(`
      SELECT u.telegram_chat_id, u.nome, f.conta_nome, f.valor_total, f.vencimento, f.alerta
      FROM v_faturas_pendentes f
      JOIN usuarios u ON f.user_id = u.id
      WHERE u.telegram_ativo = true AND f.alerta IN ('urgente', 'atrasada')
    `);

    // Agrupar por usuário
    const porUsuario = rows.reduce((acc, r) => {
      acc[r.telegram_chat_id] = acc[r.telegram_chat_id] || { nome: r.nome, faturas: [] };
      acc[r.telegram_chat_id].faturas.push(r);
      return acc;
    }, {});

    for (const [chatId, { nome, faturas }] of Object.entries(porUsuario)) {
      const linhas = faturas.map(f =>
        `${f.alerta === 'atrasada' ? '🔴' : '🚨'} ${f.conta_nome} — ${formatarMoeda(f.valor_total)} — ${f.vencimento}`
      );
      await enviarTelegram(chatId, [
        `⚠️ <b>Olá, ${nome}! Faturas a vencer:</b>`, '', ...linhas,
      ].join('\n'));
    }
  } catch (err) { console.error('[Cron alertas]', err.message); }
}, { timezone: 'America/Sao_Paulo' });
// ─────────────────────────────────────────────
// INTEGRAÇÃO STRAVA
// ─────────────────────────────────────────────
const strava = require('./integracoes/strava');

// GET /api/strava/auth — gera URL de autorização para o usuário
app.get('/api/strava/auth', autenticar, (req, res) => {
  console.log('[Strava Auth] Todas as vars:', {
    CLIENT_ID:     process.env.STRAVA_CLIENT_ID,
    CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET ? 'OK' : 'AUSENTE',
    RAILWAY_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN,
  });

  const clientId = process.env.STRAVA_CLIENT_ID;
  const baseUrl  = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'http://localhost:3000';

  const redirectUri = `${baseUrl}/webhook/strava/callback`;

  const params = new URLSearchParams({
    client_id:       clientId,
    redirect_uri:    redirectUri,
    response_type:   'code',
    approval_prompt: 'auto',
    scope:           'activity:read_all',
    state:           req.userId,
  });

  res.json({
    url: `https://www.strava.com/oauth/authorize?${params.toString()}`,
    debug: { clientId, baseUrl },
  });
});

// GET /api/strava/status — verifica se o usuário tem Strava conectado
app.get('/api/strava/status', autenticar, async (req, res) => {
  const { rows: [integ] } = await db.query(
    'SELECT strava_athlete_id, ativo, criado_em FROM integracoes_strava WHERE user_id=$1',
    [req.userId]
  );
  res.json({
    conectado: !!integ?.ativo,
    athlete_id: integ?.strava_athlete_id || null,
    desde: integ?.criado_em || null,
  });
});

// GET /webhook/strava/callback — Strava redireciona aqui após autorização
app.get('/webhook/strava/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;

  if (error) {
    return res.redirect(
      `${process.env.DASHBOARD_URL || 'https://gestao-dashboard-sigma.vercel.app'}/treino?strava=negado`
    );
  }

  try {
    // Trocar code por tokens
    const tokens = await strava.trocarCodePorTokens(code);

    // Salvar na tabela integracoes_strava
    await db.query(
      `INSERT INTO integracoes_strava
        (user_id, strava_athlete_id, access_token, refresh_token, token_expires_at, scope)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (strava_athlete_id) DO UPDATE SET
         access_token=$3, refresh_token=$4,
         token_expires_at=$5, ativo=true`,
      [
        userId,
        tokens.athlete.id,
        tokens.access_token,
        tokens.refresh_token,
        new Date(tokens.expires_at * 1000).toISOString(),
        tokens.scope,
      ]
    );

    console.log(`[Strava] Usuário ${userId} conectou Strava (athlete ${tokens.athlete.id})`);

    // Redirecionar de volta para o dashboard
    res.redirect(
      `${process.env.DASHBOARD_URL || 'https://gestao-dashboard-sigma.vercel.app'}/treino?strava=conectado`
    );
  } catch (err) {
    console.error('[Strava callback]', err.message);
    res.redirect(
      `${process.env.DASHBOARD_URL || 'https://gestao-dashboard-sigma.vercel.app'}/treino?strava=erro`
    );
  }
});

// GET /webhook/strava — verificação do webhook pelo Strava
app.get('/webhook/strava', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

  if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
    console.log('[Strava] Webhook verificado com sucesso');
    return res.json({ 'hub.challenge': challenge });
  }
  res.sendStatus(403);
});

// POST /webhook/strava — recebe notificações de atividades novas
app.post('/webhook/strava', async (req, res) => {
  // Confirmar recebimento imediatamente
  res.sendStatus(200);

  const { object_type, object_id, aspect_type, owner_id } = req.body;

  // Só processa criação de atividades
  if (object_type !== 'activity' || aspect_type !== 'create') return;

  console.log(`[Strava] Nova atividade: ${object_id} do atleta ${owner_id}`);

  try {
    // Buscar integração pelo strava_athlete_id
    const { rows: [integ] } = await db.query(
      'SELECT * FROM integracoes_strava WHERE strava_athlete_id=$1 AND ativo=true',
      [owner_id]
    );
    if (!integ) {
      console.warn(`[Strava] Atleta ${owner_id} não encontrado no banco`);
      return;
    }

    // Garantir token válido (renova se necessário)
    const accessToken = await strava.garantirTokenValido(db, integ);

    // Buscar detalhes da atividade
    const atividade = await strava.buscarAtividade(object_id, accessToken);

    // Salvar no banco
    const salva = await strava.salvarAtividade(db, integ.user_id, atividade);

    if (salva) {
      // Notificar via Telegram se o usuário tiver conectado
      const { rows: [usuario] } = await db.query(
        'SELECT telegram_chat_id, telegram_ativo FROM usuarios WHERE id=$1',
        [integ.user_id]
      );

      if (usuario?.telegram_ativo && usuario?.telegram_chat_id) {
        const { enviar } = require('./lib/telegram');
        await enviar(
          usuario.telegram_chat_id,
          `🏃 <b>Atividade importada do Strava!</b>\n\n` +
          `<b>${atividade.name}</b>\n` +
          `Tipo: ${atividade.sport_type}\n` +
          `${atividade.elapsed_time ? `Duração: ${Math.round(atividade.elapsed_time / 60)} min\n` : ''}` +
          `${atividade.distance ? `Distância: ${(atividade.distance / 1000).toFixed(1)} km\n` : ''}` +
          `${atividade.calories ? `Calorias: ${atividade.calories} kcal\n` : ''}` +
          `\n<i>Salvo automaticamente no seu histórico de treino</i>`
        );
      }
    }
  } catch (err) {
    console.error('[Strava webhook]', err.message);
  }
});

// POST /api/strava/desconectar
app.post('/api/strava/desconectar', autenticar, async (req, res) => {
  await db.query(
    'UPDATE integracoes_strava SET ativo=false WHERE user_id=$1',
    [req.userId]
  );
  res.json({ mensagem: 'Strava desconectado' });
});

// POST /api/strava/registrar-webhook — chamar uma vez para ativar
app.post('/api/strava/registrar-webhook', autenticar, async (req, res) => {
  try {
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : 'http://localhost:3000';
    const resultado = await strava.registrarWebhook(`${baseUrl}/webhook/strava`);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});
// ─────────────────────────────────────────────
// HEALTH CHECK E ROTA RAIZ
// ─────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*) FROM usuarios');
    res.json({
      status: 'ok',
      banco: 'conectado',
      usuarios: parseInt(rows[0].count),
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'erro', banco: 'desconectado' });
  }
});

app.get('/', (req, res) => res.json({
  app: 'Gestão Pessoal', versao: '1.0.0',
  modulos: ['financeiro', 'saude', 'treino', 'nutricao'],
  docs: '/health',
}));

// ─────────────────────────────────────────────
// INICIAR
// ─────────────────────────────────────────────
async function iniciar() {
  try {
    await db.query('SELECT NOW()');
    console.log('✅ Banco conectado');
    app.listen(PORT, () => console.log(`✅ Servidor na porta ${PORT}`));
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err.message);
    console.error('❌ Stack completo:', err.stack);
    console.error('❌ Detalhes:', JSON.stringify(err, null, 2));
    process.exit(1);
  }
}
iniciar();