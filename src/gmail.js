// ============================================================
// GESTÃO PESSOAL — Importador de e-mails bancários
// Arquivo: src/gmail.js
//
// Fluxo:
//   1. Para cada usuário com Gmail conectado
//   2. Busca e-mails dos últimos 7 dias dos bancos configurados
//   3. Parseia valor, tipo e descrição de cada e-mail
//   4. Deduplica por gmail_message_id antes de inserir
//   5. Salva no banco e envia confirmação via Telegram
// ============================================================

'use strict';

const { google } = require('googleapis');

// ─────────────────────────────────────────────
// PADRÕES DE REMETENTES POR BANCO
// Cada banco tem uma lista de remetentes conhecidos
// e regex para extrair valor e tipo de transação
// ─────────────────────────────────────────────
const BANCOS = [
  {
    nome:       'Nubank',
    remetentes: [
      'todomundo@nubank.com.br',
      'fatura@nubank.com.br',
      'no-reply@nubank.com.br',
      'lembretes@nubank.com.br',
    ],
    detectar(assunto, corpo) {
      const txt = `${assunto} ${corpo}`.toLowerCase();

      // Compra aprovada
      if (/compra aprovada|compra no cartão|compra realizada/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const desc  = extrairLinhaApos(corpo, ['estabelecimento:', 'local:']) || assunto;
        return valor ? { tipo: 'Saída', valor, descricao: desc, categoria: inferirCatNome(desc) } : null;
      }

      // Pix recebido
      if (/pix recebido|você recebeu um pix/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const de    = extrairLinhaApos(corpo, ['de:', 'remetente:']) || 'Pix recebido';
        return valor ? { tipo: 'Entrada', valor, descricao: `Pix recebido — ${de}`, categoria: 'Receita Extra' } : null;
      }

      // Fatura disponível
      if (/sua fatura|fatura disponível|fatura chegou/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const venc  = extrairDataTexto(corpo);
        return valor ? {
          tipo: 'fatura',
          valor,
          descricao: `Fatura Nubank`,
          vencimento: venc,
          categoria: 'Fatura Cartão',
        } : null;
      }

      return null;
    },
  },

  {
    nome:       'Mercado Pago',
    remetentes: [
      'info@mercadopago.com',
      'nao-responder@mercadopago.com',
      'no-reply@mercadopago.com.br',
    ],
    detectar(assunto, corpo) {
      const txt = `${assunto} ${corpo}`.toLowerCase();

      // Pix recebido
      if (/você recebeu|pix recebido|recebeu um pix/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const de    = extrairLinhaApos(corpo, ['de ', 'enviou']) || 'Pix recebido';
        return valor ? { tipo: 'Entrada', valor, descricao: `Pix recebido — ${de}`, categoria: 'Receita Extra' } : null;
      }

      // Pagamento/cobrança
      if (/pagamento aprovado|você pagou|débito realizado/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const desc  = extrairLinhaApos(corpo, ['para:', 'estabelecimento:', 'descrição:']) || assunto;
        return valor ? { tipo: 'Saída', valor, descricao: desc, categoria: inferirCatNome(desc) } : null;
      }

      // Cobrança recorrente (assinatura)
      if (/cobrança recorrente|assinatura/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const desc  = extrairLinhaApos(corpo, ['serviço:', 'plano:']) || 'Assinatura MP';
        return valor ? { tipo: 'Saída', valor, descricao: desc, categoria: 'Assinatura' } : null;
      }

      return null;
    },
  },

  {
    nome:       'Caixa',
    remetentes: [
      'caixaeconomicafederal@inf.caixa.gov.br',
      'naoresponda@caixa.gov.br',
    ],
    detectar(assunto, corpo) {
      const txt = `${assunto} ${corpo}`.toLowerCase();

      if (/débito em conta|aviso de débito/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const fav   = extrairLinhaApos(corpo, ['favorecido:', 'beneficiário:']) || assunto;
        return valor ? { tipo: 'Saída', valor, descricao: fav, categoria: inferirCatNome(fav) } : null;
      }

      if (/crédito em conta|depósito/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        return valor ? { tipo: 'Entrada', valor, descricao: 'Crédito Caixa', categoria: 'Receita Extra' } : null;
      }

      return null;
    },
  },

  {
    nome:       'C6 Bank',
    remetentes: [
      'contato@c6bank.com.br',
      'noreply@c6bank.com.br',
      'no-reply@c6bank.com.br',
    ],
    detectar(assunto, corpo) {
      const txt = `${assunto} ${corpo}`.toLowerCase();

      if (/compra aprovada|transação aprovada/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        const desc  = extrairLinhaApos(corpo, ['estabelecimento:', 'local:']) || assunto;
        return valor ? { tipo: 'Saída', valor, descricao: desc, categoria: inferirCatNome(desc) } : null;
      }

      if (/fatura|sua fatura c6/.test(txt)) {
        const valor   = extrairValorTexto(corpo);
        const venc    = extrairDataTexto(corpo);
        return valor ? {
          tipo: 'fatura',
          valor,
          descricao: 'Fatura C6 Bank',
          vencimento: venc,
          categoria: 'Fatura Cartão',
        } : null;
      }

      return null;
    },
  },

  {
    nome:       'Bradesco',
    remetentes: ['bradesco@bradesco.com.br', 'noreply@bradesco.com.br'],
    detectar(assunto, corpo) {
      const txt = `${assunto} ${corpo}`.toLowerCase();
      if (/débito|pagamento/.test(txt)) {
        const valor = extrairValorTexto(corpo);
        return valor ? { tipo: 'Saída', valor, descricao: assunto, categoria: inferirCatNome(assunto) } : null;
      }
      return null;
    },
  },

  {
    nome:       'Itaú',
    remetentes: ['itau@itau.com.br', 'nao-responda@itau.com.br'],
    detectar(assunto, corpo) {
      const valor = extrairValorTexto(corpo);
      const txt   = `${assunto} ${corpo}`.toLowerCase();
      if (!valor) return null;
      const tipo = /receb|crédito|entrada/.test(txt) ? 'Entrada' : 'Saída';
      return { tipo, valor, descricao: assunto, categoria: inferirCatNome(assunto) };
    },
  },
];

// ─────────────────────────────────────────────
// HELPERS DE EXTRAÇÃO
// ─────────────────────────────────────────────

function extrairValorTexto(texto) {
  const padroes = [
    /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/,
    /valor[:\s]+R?\$?\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
    /([\d]{1,3}(?:\.\d{3})*,\d{2})/,
  ];
  for (const p of padroes) {
    const m = texto.match(p);
    if (m) {
      const v = parseFloat(m[1].replace(/\./g,'').replace(',','.'));
      if (v > 0) return v;
    }
  }
  return null;
}

function extrairLinhaApos(texto, prefixos) {
  for (const pref of prefixos) {
    const re = new RegExp(`${pref.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*(.+)`, 'im');
    const m  = texto.match(re);
    if (m) return m[1].trim().replace(/\n.*/,'').substring(0, 60);
  }
  return null;
}

function extrairDataTexto(texto) {
  // Formatos: "06/04/2026", "6 de abril de 2026", "2026-04-06"
  const padroes = [
    /(\d{2})\/(\d{2})\/(\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/i,
  ];
  const meses = {
    janeiro:'01',fevereiro:'02',março:'03',marco:'03',
    abril:'04',maio:'05',junho:'06',julho:'07',
    agosto:'08',setembro:'09',outubro:'10',
    novembro:'11',dezembro:'12',
  };

  for (const p of padroes) {
    const m = texto.match(p);
    if (m) {
      if (p.source.includes('de')) {
        const mes = meses[m[2].toLowerCase()];
        if (mes) return `${m[3]}-${mes}-${String(m[1]).padStart(2,'0')}`;
      } else if (p.source.startsWith('(\\d{4})')) {
        return `${m[1]}-${m[2]}-${m[3]}`;
      } else {
        return `${m[3]}-${m[2]}-${m[1]}`;
      }
    }
  }

  // Fallback: 30 dias a partir de hoje
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split('T')[0];
}

function inferirCatNome(texto) {
  const t = texto.toLowerCase();
  if (/gasolina|posto|uber|transporte/.test(t))         return 'Transporte';
  if (/mercado|supermercado|ifood|restaurante|padaria/.test(t)) return 'Alimentação';
  if (/farmácia|drogaria|remédio|saúde/.test(t))        return 'Saúde';
  if (/netflix|spotify|assinatura|amazon/.test(t))      return 'Assinatura';
  if (/energia|edp|cpfl|luz|água|sabesp/.test(t))       return 'Moradia';
  if (/sky|claro|vivo|tim|internet/.test(t))             return 'Moradia';
  if (/fatura|cartão/.test(t))                          return 'Fatura Cartão';
  return 'Outros';
}

function competenciaDe(dataStr) {
  const d = dataStr ? new Date(dataStr) : new Date();
  return String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}

// ─────────────────────────────────────────────
// DECODIFICAR CORPO DO E-MAIL (base64url)
// ─────────────────────────────────────────────
function decodificarParte(parte) {
  if (!parte?.body?.data) return '';
  try {
    return Buffer.from(parte.body.data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

function extrairCorpo(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html') {
    return decodificarParte(payload);
  }
  if (payload.parts) {
    for (const parte of payload.parts) {
      const texto = extrairCorpo(parte);
      if (texto) return texto;
    }
  }
  return '';
}

// ─────────────────────────────────────────────
// CRIAR CLIENTE GMAIL PARA UM USUÁRIO
// ─────────────────────────────────────────────
function criarClienteGmail(accessToken, refreshToken) {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  auth.setCredentials({
    access_token:  accessToken,
    refresh_token: refreshToken,
  });
  return google.gmail({ version: 'v1', auth });
}

// ─────────────────────────────────────────────
// IDENTIFICAR BANCO PELO REMETENTE
// ─────────────────────────────────────────────
function identificarBanco(remetente) {
  const r = (remetente || '').toLowerCase();
  return BANCOS.find(b =>
    b.remetentes.some(rem => r.includes(rem.toLowerCase()))
  ) || null;
}

// ─────────────────────────────────────────────
// BUSCAR CONTA DO USUÁRIO PELO BANCO DETECTADO
// ─────────────────────────────────────────────
async function buscarContaPorBanco(db, userId, nomesBanco) {
  // Tenta achar uma conta do usuário cujo nome contenha o nome do banco
  const { rows } = await db.query(
    `SELECT id, nome FROM contas
     WHERE user_id=$1 AND ativa=true
       AND (${nomesBanco.map((_,i) => `nome ILIKE $${i+2}`).join(' OR ')})
     LIMIT 1`,
    [userId, ...nomesBanco.map(n => `%${n}%`)]
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────
// PROCESSAR UM ÚNICO E-MAIL
// ─────────────────────────────────────────────
async function processarEmail(db, userId, gmail, messageId, banco) {
  // Buscar detalhes do e-mail
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id:     messageId,
    format: 'full',
  });

  const headers = msg.data.payload.headers || [];
  const assunto = headers.find(h => h.name === 'Subject')?.value || '';
  const de      = headers.find(h => h.name === 'From')?.value    || '';
  const corpo   = extrairCorpo(msg.data.payload);

  // Parsear conteúdo do e-mail
  const resultado = banco.detectar(assunto, corpo);
  if (!resultado) {
    // E-mail reconhecido mas sem dados estruturados
    await db.query(
      `INSERT INTO importacoes_gmail (user_id, gmail_message_id, remetente, assunto, banco_detectado, status)
       VALUES ($1,$2,$3,$4,$5,'ignorado') ON CONFLICT DO NOTHING`,
      [userId, messageId, de, assunto, banco.nome]
    );
    return { status: 'ignorado', motivo: 'sem dados extraíveis' };
  }

  // Verificar duplicata
  const { rows: [dup] } = await db.query(
    'SELECT id FROM lancamentos WHERE user_id=$1 AND gmail_message_id=$2',
    [userId, messageId]
  );
  if (dup) return { status: 'duplicado', id: dup.id };

  const hoje      = new Date().toISOString().split('T')[0];
  const competencia = competenciaDe(hoje);

  // Tratar como FATURA (não é lançamento, é compromisso futuro)
  if (resultado.tipo === 'fatura') {
    const conta = await buscarContaPorBanco(db, userId, [banco.nome]);
    if (conta) {
      const { rows: [fat] } = await db.query(
        `INSERT INTO faturas (user_id, conta_id, descricao, valor_total, vencimento, mes_referencia, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Pendente')
         ON CONFLICT DO NOTHING RETURNING id`,
        [userId, conta.id, resultado.descricao, resultado.valor,
         resultado.vencimento || hoje, competencia]
      );
      if (fat) {
        await db.query(
          `INSERT INTO importacoes_gmail (user_id, gmail_message_id, remetente, assunto, banco_detectado, status)
           VALUES ($1,$2,$3,$4,$5,'processado') ON CONFLICT DO NOTHING`,
          [userId, messageId, de, assunto, banco.nome]
        );
        return { status: 'fatura_criada', id: fat.id };
      }
    }
    return { status: 'ignorado', motivo: 'conta do banco não encontrada' };
  }

  // Tratar como LANÇAMENTO normal
  const conta = await buscarContaPorBanco(db, userId, [banco.nome]);
  if (!conta) {
    await db.query(
      `INSERT INTO importacoes_gmail (user_id, gmail_message_id, remetente, assunto, banco_detectado, status, erro_msg)
       VALUES ($1,$2,$3,$4,$5,'revisao','Conta não encontrada') ON CONFLICT DO NOTHING`,
      [userId, messageId, de, assunto, banco.nome]
    );
    return { status: 'revisao', motivo: 'conta não encontrada' };
  }

  const { rows: [lanc] } = await db.query(
    `INSERT INTO lancamentos
      (user_id, data, descricao, valor, tipo, conta_origem_id,
       categoria_nome, forma_pagamento, status, competencia, fonte, gmail_message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Pix','Pago',$8,'Gmail',$9)
     RETURNING id`,
    [userId, hoje, resultado.descricao, resultado.valor, resultado.tipo,
     conta.id, resultado.categoria, competencia, messageId]
  );

  await db.query(
    `INSERT INTO importacoes_gmail (user_id, gmail_message_id, remetente, assunto, banco_detectado, status, lancamento_id)
     VALUES ($1,$2,$3,$4,$5,'processado',$6) ON CONFLICT DO NOTHING`,
    [userId, messageId, de, assunto, banco.nome, lanc.id]
  );

  return { status: 'importado', id: lanc.id, valor: resultado.valor, tipo: resultado.tipo };
}

// ─────────────────────────────────────────────
// IMPORTAR E-MAILS DE UM USUÁRIO
// ─────────────────────────────────────────────
async function importarEmailsUsuario(db, usuario) {
  if (!usuario.gmail_access_token || !usuario.gmail_refresh_token) return null;

  const gmail = criarClienteGmail(
    usuario.gmail_access_token,
    usuario.gmail_refresh_token
  );

  // Montar query de busca no Gmail: todos os remetentes dos bancos
  const todosRemetentes = BANCOS.flatMap(b => b.remetentes);
  const queryGmail = [
    `(${todosRemetentes.map(r => `from:${r}`).join(' OR ')})`,
    'newer_than:7d',
  ].join(' ');

  let mensagens;
  try {
    const resp = await gmail.users.messages.list({
      userId: 'me',
      q:      queryGmail,
      maxResults: 50,
    });
    mensagens = resp.data.messages || [];
  } catch (err) {
    console.error(`[Gmail] Erro ao listar e-mails user ${usuario.id}:`, err.message);
    return null;
  }

  if (!mensagens.length) return { total: 0, importados: 0, ignorados: 0 };

  let importados = 0, ignorados = 0, revisao = 0;

  for (const msg of mensagens) {
    try {
      // Buscar remetente sem baixar o e-mail completo ainda
      const meta = await gmail.users.messages.get({
        userId: 'me', id: msg.id, format: 'metadata',
        metadataHeaders: ['From'],
      });
      const de      = meta.data.payload.headers.find(h => h.name === 'From')?.value || '';
      const banco   = identificarBanco(de);
      if (!banco) { ignorados++; continue; }

      const res = await processarEmail(db, usuario.id, gmail, msg.id, banco);

      if (res.status === 'importado')      importados++;
      else if (res.status === 'revisao')   revisao++;
      else                                 ignorados++;

    } catch (err) {
      console.error(`[Gmail] Erro msg ${msg.id}:`, err.message);
      ignorados++;
    }
  }

  return { total: mensagens.length, importados, ignorados, revisao };
}

// ─────────────────────────────────────────────
// FUNÇÃO PRINCIPAL — rodar a cada 15 minutos
// Chamada pelo cron job no index.js
// ─────────────────────────────────────────────
async function importarTodos(db) {
  if (process.env.GMAIL_ENABLED !== 'true') return;

  let usuarios;
  try {
    const { rows } = await db.query(
      `SELECT id, nome, gmail_access_token, gmail_refresh_token, telegram_chat_id
       FROM usuarios
       WHERE gmail_access_token IS NOT NULL
         AND gmail_refresh_token IS NOT NULL
         AND ativo = true`
    );
    usuarios = rows;
  } catch (err) {
    console.error('[Gmail] Erro ao buscar usuários:', err.message);
    return;
  }

  console.log(`[Gmail] Importando para ${usuarios.length} usuário(s)...`);

  for (const usuario of usuarios) {
    const resultado = await importarEmailsUsuario(db, usuario);
    if (!resultado) continue;

    console.log(
      `[Gmail] ${usuario.nome}: +${resultado.importados} importados, ` +
      `${resultado.ignorados} ignorados, ${resultado.revisao || 0} para revisão`
    );

    // Notificar via Telegram se importou algo
    if (resultado.importados > 0 && usuario.telegram_chat_id) {
      const { enviar } = require('./lib/telegram');
      await enviar(
        usuario.telegram_chat_id,
        `📧 <b>${resultado.importados} lançamento(s) importado(s) do e-mail</b>\n` +
        `<i>Acesse o app para verificar os detalhes</i>`
      );
    }
  }
}

// ─────────────────────────────────────────────
// ROTA DE AUTORIZAÇÃO GMAIL (OAuth2)
// Adicionar no index.js: app.get('/auth/gmail', ...)
// ─────────────────────────────────────────────
function gerarUrlAutorizacao() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );
  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent',
  });
}

async function trocarCodigoPorTokens(code) {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );
  const { tokens } = await auth.getToken(code);
  return tokens;
}

module.exports = {
  importarTodos,
  importarEmailsUsuario,
  gerarUrlAutorizacao,
  trocarCodigoPorTokens,
  BANCOS,
};
