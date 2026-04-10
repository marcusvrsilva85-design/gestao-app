// ============================================================
// GESTÃO PESSOAL — Parser NLP dinâmico
// Arquivo: src/nlp.js
//
// Diferença crucial em relação à versão pessoal:
//   - Contas e aliases carregados do banco por usuário
//   - Categorias carregadas do banco (padrão + personalizadas)
//   - Cache por usuário (TTL 5 min) para não bater no banco a cada msg
//   - Funciona com qualquer usuário, qualquer estrutura de contas
// ============================================================

'use strict';

// ─────────────────────────────────────────────
// CACHE POR USUÁRIO
// Evita buscar contas e categorias no banco
// a cada mensagem do Telegram
// ─────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function cacheGet(userId) {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return entry.data;
}

function cacheSet(userId, data) {
  cache.set(userId, { data, timestamp: Date.now() });
}

// Invalida o cache de um usuário (chamar quando ele adiciona/remove conta)
function invalidarCache(userId) {
  cache.delete(userId);
}

// ─────────────────────────────────────────────
// CARREGAR CONTEXTO DO USUÁRIO
// Retorna { contas, contaAliases, categorias }
// ─────────────────────────────────────────────
async function carregarContexto(db, userId) {
  const cached = cacheGet(userId);
  if (cached) return cached;

  // Buscar contas ativas do usuário
  const { rows: contas } = await db.query(
    `SELECT id, nome, tipo, banco
     FROM contas
     WHERE user_id = $1 AND ativa = true
     ORDER BY nome`,
    [userId]
  );

  // Buscar categorias (padrão + personalizadas do usuário)
  const { rows: categorias } = await db.query(
    `SELECT id, nome, tipo
     FROM categorias
     WHERE user_id IS NULL OR user_id = $1
     ORDER BY nome`,
    [userId]
  );

  // Construir mapa de aliases → UUID
  // Gera variações automáticas a partir do nome da conta
  const contaAliases = construirAliases(contas);

  const contexto = { contas, contaAliases, categorias };
  cacheSet(userId, contexto);
  return contexto;
}

// ─────────────────────────────────────────────
// CONSTRUIR ALIASES DE CONTAS
// A partir do nome cadastrado, gera variações
// que o usuário pode usar ao digitar
//
// Ex: "Mercado Pago CC" gera:
//   "mercado pago cc", "mercado pago", "mp", "mercadopago"
// ─────────────────────────────────────────────
function construirAliases(contas) {
  const aliases = new Map(); // alias (lower) → { id, nome }

  for (const conta of contas) {
    const nome = conta.nome;
    const lower = nome.toLowerCase();
    const id = conta.id;
    const ref = { id, nome };

    // Nome completo sempre mapeado
    aliases.set(lower, ref);

    // Sem sufixos comuns
    const semSufixo = lower
      .replace(/\s+(cc|pf|pj|conta|cartão|cartao|digital|bank|bank cc)$/i, '')
      .trim();
    if (semSufixo !== lower) aliases.set(semSufixo, ref);

    // Siglas: "Mercado Pago" → "mp", "Itaú" → "itau"
    const sigla = gerarSigla(semSufixo);
    if (sigla && sigla.length >= 2) aliases.set(sigla, ref);

    // Sem acentos
    const semAcento = removerAcentos(lower);
    if (semAcento !== lower) aliases.set(semAcento, ref);

    // Banco como alias (ex: "nubank" → conta Nubank CC)
    if (conta.banco) {
      const bancoLower = removerAcentos(conta.banco.toLowerCase());
      if (!aliases.has(bancoLower)) aliases.set(bancoLower, ref);
    }

    // Variações específicas conhecidas
    const variacoes = variacoesConhecidas(lower);
    for (const v of variacoes) {
      if (!aliases.has(v)) aliases.set(v, ref);
    }
  }

  return aliases;
}

function gerarSigla(texto) {
  // "mercado pago" → "mp"
  const palavras = texto.split(/\s+/).filter(p => p.length > 1);
  if (palavras.length >= 2) return palavras.map(p => p[0]).join('');
  return null;
}

function removerAcentos(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function variacoesConhecidas(lower) {
  const mapa = {
    'nubank cc':        ['nubank', 'nu', 'nub'],
    'mercado pago cc':  ['mercado pago', 'mp', 'mercadopago', 'meli'],
    'cofrinho mp':      ['cofrinho', 'cofre', 'reserva mp'],
    'caixa cef':        ['caixa', 'cef', 'caixa economica', 'caixa econômica'],
    'c6 bank cc':       ['c6', 'c6 bank', 'c6bank'],
    'bradesco':         ['bradesco', 'brad'],
    'itau':             ['itaú', 'itau'],
    'santander':        ['santander', 'sant'],
    'banco do brasil':  ['bb', 'banco brasil'],
    'inter':            ['inter', 'banco inter'],
    'picpay':           ['picpay', 'pic pay'],
  };

  for (const [key, vars] of Object.entries(mapa)) {
    if (lower.includes(key) || key.includes(lower)) return vars;
  }
  return [];
}

// ─────────────────────────────────────────────
// EXTRAIR VALOR MONETÁRIO
// Aceita: "50", "50,00", "R$50", "R$ 50,00"
// Retorna número float ou null
// ─────────────────────────────────────────────
function extrairValor(texto) {
  // Múltiplos padrões em ordem de especificidade
  const padroes = [
    /R\$\s*([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,  // R$ 1.234,56
    /R\$\s*([\d]+(?:,\d{2})?)/i,                   // R$ 50,00
    /(?:de|no?\s+valor\s+de|valor\s+de|por)\s+([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)/i,
    /([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:reais?|conto)/i,
    /([\d]+(?:[.,]\d{2})?)/,                        // qualquer número
  ];

  for (const padrao of padroes) {
    const match = texto.match(padrao);
    if (match) {
      const str = match[1]
        .replace(/\./g, '')   // remover separador de milhar
        .replace(',', '.');   // vírgula decimal → ponto
      const val = parseFloat(str);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// EXTRAIR CONTA DO TEXTO
// Usa os aliases do usuário carregados do banco
// ─────────────────────────────────────────────
function extrairConta(texto, contaAliases, contaPadrao = null) {
  const lower = removerAcentos(texto.toLowerCase());

  // Ordenar aliases do maior para o menor (mais específico primeiro)
  const aliasesOrdenados = [...contaAliases.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, conta] of aliasesOrdenados) {
    if (lower.includes(alias)) return conta;
  }

  // Fallback: primeira conta ativa do usuário (ou null)
  return contaPadrao;
}

// ─────────────────────────────────────────────
// INFERIR CATEGORIA
// Primeiro tenta categorias do banco (por nome),
// depois aplica regras por palavras-chave
// ─────────────────────────────────────────────
function inferirCategoria(texto, categorias) {
  const lower = removerAcentos(texto.toLowerCase());

  // Mapa de palavras-chave → nome de categoria
  // (compatível com as categorias padrão do sistema)
  const regras = [
    // Alimentação
    { cat: 'Alimentação',      kw: ['mercado','supermercado','fair','hiper','ifood','rappi',
                                     'delivery','restaurante','lanche','cafe','café','padaria',
                                     'pizza','hamburguer','hambúrguer','açougue','hortifruti',
                                     'pao','pão','sushi','japonese','comida'] },
    // Transporte
    { cat: 'Transporte',       kw: ['gasolina','combustivel','combustível','posto','uber',
                                     'cabify','99pop','onibus','ônibus','metro','metrô',
                                     'estacionamento','pedagio','pedágio','moto'] },
    // Saúde
    { cat: 'Saúde',            kw: ['farmacia','farmácia','drogaria','remedio','remédio',
                                     'medico','médico','consulta','hospital','laboratorio',
                                     'exame','dentista','academia'] },
    // Moradia
    { cat: 'Moradia',          kw: ['aluguel','condominio','condomínio','iptu','seguro imovel'] },
    // Energia e internet
    { cat: 'Moradia',          kw: ['luz','energia','edp','cpfl','sabesp','agua','água',
                                     'gas','gás','internet','fibra','sky','claro','vivo','tim'] },
    // Assinatura
    { cat: 'Assinatura',       kw: ['netflix','spotify','youtube','amazon','prime','hbo',
                                     'apple','disney','globoplay','paramount','meli','melimais'] },
    // Fatura
    { cat: 'Fatura Cartão',    kw: ['fatura','pagamento fatura'] },
    // Dívida
    { cat: 'Dívida/Encargo',   kw: ['juro','juros','iof','multa','encargo','emprestimo',
                                     'empréstimo','divida','dívida','parcela'] },
    // Educação
    { cat: 'Educação',         kw: ['escola','faculdade','curso','livro','material escolar',
                                     'mensalidade','colegio','colégio'] },
    // Lazer
    { cat: 'Lazer',            kw: ['cinema','show','ingresso','parque','viagem','hotel',
                                     'passagem','voo','lazer'] },
    // Investimento
    { cat: 'Investimento',     kw: ['investimento','aplicacao','aplicação','cdb','tesouro',
                                     'acao','ação','fundo','renda fixa'] },
    // Reserva
    { cat: 'Reserva/Cofrinho', kw: ['cofrinho','reserva','poupança','poupanca','guardar'] },
    // Receitas
    { cat: 'Receita Salário',  kw: ['salario','salário','pagamento','vale','adiantamento',
                                     'holerite','contracheque'] },
    { cat: 'Receita Extra',    kw: ['freela','freelas','freelance','bonus','bônus','comissao',
                                     'comissão','gorjeta','extra'] },
    // Vestuário
    { cat: 'Vestuário',        kw: ['roupa','sapato','tenis','tênis','camisa','calca','calça',
                                     'vestido','loja','shopping'] },
  ];

  for (const { cat, kw } of regras) {
    if (kw.some(k => lower.includes(k))) {
      // Verificar se essa categoria existe nas categorias do banco
      const catBanco = categorias.find(c =>
        removerAcentos(c.nome.toLowerCase()) === removerAcentos(cat.toLowerCase())
      );
      if (catBanco) return { id: catBanco.id, nome: catBanco.nome };
    }
  }

  // Fallback: categoria "Outros"
  const outros = categorias.find(c => c.nome === 'Outros');
  return outros
    ? { id: outros.id, nome: outros.nome }
    : { id: null, nome: 'Outros' };
}

// ─────────────────────────────────────────────
// EXTRAIR FORMA DE PAGAMENTO
// ─────────────────────────────────────────────
function extrairForma(texto) {
  const lower = texto.toLowerCase();
  if (/\bdébito\b|\bdebit\b/.test(lower))        return 'Débito';
  if (/\bcrédito\b|\bcredito\b|\bcredit\b/.test(lower)) return 'Crédito';
  if (/\bdinheiro\b|\bcash\b|\bespécie\b/.test(lower))  return 'Dinheiro';
  if (/\bboleto\b/.test(lower))                  return 'Boleto';
  if (/\bted\b|\bdoc\b/.test(lower))             return 'TED/DOC';
  return 'Pix'; // padrão
}

// ─────────────────────────────────────────────
// EXTRAIR COMPETÊNCIA DO TEXTO
// Aceita "mês passado", "março", "04/2026" etc.
// ─────────────────────────────────────────────
function extrairCompetencia(texto) {
  const lower = texto.toLowerCase();
  const agora = new Date();
  const mes   = agora.getMonth() + 1;
  const ano   = agora.getFullYear();

  // "mês passado" / "mes passado"
  if (/m[eê]s passado/.test(lower)) {
    const m = mes === 1 ? 12 : mes - 1;
    const a = mes === 1 ? ano - 1 : ano;
    return `${String(m).padStart(2,'0')}/${a}`;
  }

  // Formato explícito "04/2026" ou "4/2026"
  const matchExp = texto.match(/(\d{1,2})\/(\d{4})/);
  if (matchExp) {
    return `${String(matchExp[1]).padStart(2,'0')}/${matchExp[2]}`;
  }

  // Nome do mês por extenso
  const meses = {
    janeiro:1, fevereiro:2, março:3, marco:3, abril:4, maio:5,
    junho:6, julho:7, agosto:8, setembro:9, outubro:10,
    novembro:11, dezembro:12
  };
  for (const [nome, num] of Object.entries(meses)) {
    if (lower.includes(nome)) {
      return `${String(num).padStart(2,'0')}/${ano}`;
    }
  }

  // Padrão: mês atual
  return `${String(mes).padStart(2,'0')}/${ano}`;
}

// ─────────────────────────────────────────────
// DETECTAR TIPO DE OPERAÇÃO
// Retorna: 'transferencia' | 'entrada' | 'saida' | 'consulta' | 'desconhecido'
// ─────────────────────────────────────────────
function detectarTipo(texto) {
  const lower = removerAcentos(texto.toLowerCase()).trim();

  // Comandos de consulta
  if (/^\/?(saldo|saldos)$/.test(lower))          return 'consulta_saldo';
  if (/^\/?resumo$|^\/?mes$/.test(lower))          return 'consulta_mes';
  if (/^\/?faturas?$/.test(lower))                 return 'consulta_faturas';
  if (/^\/?ajuda$|^\/?help$/.test(lower))          return 'consulta_ajuda';
  if (/^\/?extrato/.test(lower))                   return 'consulta_extrato';
  if (/^\/?metas?$/.test(lower))                   return 'consulta_metas';

  // Transferência entre contas próprias
  if (/transfer[ei]|pix.*para|mandei.*para|enviei.*para/.test(lower) &&
      /para/.test(lower))                          return 'transferencia';

  // Entradas
  if (/receb[ei]+|entrou|ganhei|caiu|depositei|pagaram|me pagaram/.test(lower))
    return 'entrada';

  // Saídas (mais abrangente — fallback principal)
  if (/pagu[ei]+|gastei|comprei|saiu|debitou|descontou|cobrou|retirei/.test(lower))
    return 'saida';

  return 'saida'; // default conservador
}

// ─────────────────────────────────────────────
// EXTRAIR DESCRIÇÃO LIMPA
// Remove valor, conta e palavras de ação
// ─────────────────────────────────────────────
function extrairDescricao(texto, tipo) {
  let desc = texto

  // Remover valor
    .replace(/R?\$?\s*[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?/g, '')

  // Remover palavras de ação
    .replace(/\b(paguei|gastei|comprei|recebi|recebei|entrou|transferi|mandei|enviei|fiz um pix de?|ganhei)\b/gi, '')

  // Remover conectivos de conta
    .replace(/\b(no?|na|do?|da|ao?|para o?|para a|com|pelo?|pela|em|via)\b/gi, ' ')

  // Remover forma de pagamento
    .replace(/\b(débito|crédito|pix|dinheiro|boleto|ted|doc|espécie)\b/gi, '')

  // Limpar espaços múltiplos
    .replace(/\s+/g, ' ')
    .trim();

  // Se ficou vazio ou muito curto, usar um padrão
  if (desc.length < 3) {
    desc = tipo === 'entrada' ? 'Recebimento' : 'Despesa';
  }

  // Capitalizar primeira letra
  return desc.charAt(0).toUpperCase() + desc.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────
// PARSEAR TRANSFERÊNCIA
// Ex: "transferi 500 da caixa para o nubank"
//     "fiz um pix de 100 do mp pro c6"
// ─────────────────────────────────────────────
function parsearTransferencia(texto, valor, contaAliases, contaPadrao) {
  // Padrões de captura de origem e destino
  const padroes = [
    /(?:d[ao]?|de)\s+(.+?)\s+(?:para|pro[a]?|pra)\s+(?:o\s+|a\s+)?(.+?)(?:\s+R?\$.*)?$/i,
    /(.+?)\s+(?:para|pro[a]?|pra)\s+(?:o\s+|a\s+)?(.+?)$/i,
  ];

  for (const padrao of padroes) {
    const match = texto.match(padrao);
    if (match) {
      const contaO = extrairConta(match[1], contaAliases, contaPadrao);
      const contaD = extrairConta(match[2], contaAliases, contaPadrao);
      if (contaO && contaD && contaO.id !== contaD.id) {
        return { contaOrigem: contaO, contaDestino: contaD };
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// FUNÇÃO PRINCIPAL: parsearMensagem
// Recebe texto + contexto do usuário,
// retorna objeto estruturado para salvar no banco
// ─────────────────────────────────────────────
async function parsearMensagem(texto, db, userId) {
  const textoLimpo = texto.trim();

  // Carregar contexto do usuário (com cache)
  const { contas, contaAliases, categorias } = await carregarContexto(db, userId);

  // Conta padrão = primeira conta corrente do usuário
  const contaPadrao = contas.find(c =>
    c.tipo === 'Conta Corrente' || c.tipo === 'Carteira Digital'
  ) || contas[0] || null;

  // Detectar tipo de operação
  const tipo = detectarTipo(textoLimpo);

  // ── CONSULTAS (não salvam nada) ──
  if (tipo.startsWith('consulta_')) {
    return { acao: tipo, texto: textoLimpo };
  }

  // ── EXTRAIR VALOR ──
  const valor = extrairValor(textoLimpo);
  if (!valor) {
    return {
      acao:  'erro',
      campo: 'valor',
      msg:   'Não consegui identificar o valor. Tente: "paguei R$ 50 de gasolina"',
      texto: textoLimpo,
    };
  }

  const competencia = extrairCompetencia(textoLimpo);
  const forma       = extrairForma(textoLimpo);

  // ── TRANSFERÊNCIA ──
  if (tipo === 'transferencia') {
    const pares = parsearTransferencia(textoLimpo, valor, contaAliases, contaPadrao);

    if (!pares) {
      return {
        acao:  'erro',
        campo: 'contas',
        msg:   'Não identifiquei as contas. Tente: "transferi 500 da caixa para o nubank"',
        texto: textoLimpo,
      };
    }

    if (!pares.contaOrigem || !pares.contaDestino) {
      return {
        acao:  'erro',
        campo: 'contas',
        msg:   'Não reconheci uma das contas. Confira os nomes no app.',
        texto: textoLimpo,
        contaOrigem: pares.contaOrigem,
        contaDestino: pares.contaDestino,
      };
    }

    return {
      acao:         'transferencia',
      valor,
      contaOrigem:  pares.contaOrigem,
      contaDestino: pares.contaDestino,
      descricao:    `Transf. ${pares.contaOrigem.nome} → ${pares.contaDestino.nome}`,
      forma,
      competencia,
      confianca:    'alta',
    };
  }

  // ── ENTRADA ──
  if (tipo === 'entrada') {
    const conta    = extrairConta(textoLimpo, contaAliases, contaPadrao);
    const cat      = inferirCategoria(textoLimpo, categorias);

    // Tentar extrair quem pagou ("recebi X da Raquel")
    const matchDe  = textoLimpo.match(/(?:d[ao]?|de)\s+([A-Za-záéíóúãõ\s]{2,25})(?:\s|$)/i);
    const quem     = matchDe
      ? matchDe[1].trim().replace(/\b(conta|banco|cartao|cartão)\b/i,'').trim()
      : null;

    const descricao = quem
      ? `Recebido — ${quem.charAt(0).toUpperCase() + quem.slice(1)}`
      : extrairDescricao(textoLimpo, 'entrada');

    return {
      acao:        'entrada',
      valor,
      contaOrigem: conta,
      descricao,
      categoria:   cat,
      forma,
      competencia,
      confianca:   conta ? 'alta' : 'media',
    };
  }

  // ── SAÍDA (default) ──
  const conta    = extrairConta(textoLimpo, contaAliases, contaPadrao);
  const cat      = inferirCategoria(textoLimpo, categorias);
  const descricao = extrairDescricao(textoLimpo, 'saida');

  return {
    acao:        'saida',
    valor,
    contaOrigem: conta,
    descricao,
    categoria:   cat,
    forma,
    competencia,
    confianca:   conta ? 'alta' : 'media',
  };
}

// ─────────────────────────────────────────────
// FORMATAR CONFIRMAÇÃO PARA TELEGRAM
// ─────────────────────────────────────────────
function formatarConfirmacao(parsed) {
  const emoji = {
    entrada:       '✅',
    saida:         '💸',
    transferencia: '🔄',
  }[parsed.acao] || '📝';

  const valor = `R$ ${parsed.valor.toFixed(2).replace('.', ',')}`;

  if (parsed.acao === 'transferencia') {
    return [
      `${emoji} <b>Transferência registrada!</b>`,
      '',
      `De:   <b>${parsed.contaOrigem.nome}</b>`,
      `Para: <b>${parsed.contaDestino.nome}</b>`,
      `Valor: ${valor}`,
      `Forma: ${parsed.forma}`,
    ].join('\n');
  }

  const linhas = [
    `${emoji} <b>Lançamento registrado!</b>`,
    '',
    `<b>${parsed.descricao}</b>`,
    `Valor: ${valor}`,
  ];

  if (parsed.contaOrigem) linhas.push(`Conta: ${parsed.contaOrigem.nome}`);
  if (parsed.categoria)   linhas.push(`Categoria: ${parsed.categoria.nome}`);
  if (parsed.forma)       linhas.push(`Forma: ${parsed.forma}`);
  linhas.push(`Competência: ${parsed.competencia}`);

  // Aviso se confiança baixa (conta não identificada)
  if (parsed.confianca === 'media') {
    linhas.push('');
    linhas.push('⚠️ <i>Conta não identificada — usando conta padrão</i>');
  }

  return linhas.join('\n');
}

// ─────────────────────────────────────────────
// CONVERTER parsed → INSERT no banco
// Retorna os params prontos para db.query()
// ─────────────────────────────────────────────
function parsedParaInsert(parsed, userId) {
  const hoje = new Date().toISOString().split('T')[0];

  if (parsed.acao === 'transferencia') {
    return {
      tipo: 'transferencia',
      params: [
        userId,
        hoje,
        parsed.descricao,
        parsed.valor,
        parsed.contaOrigem.id,
        parsed.contaDestino.id,
        parsed.forma,
        parsed.competencia,
        'Telegram',
        null, // observação
      ],
    };
  }

  return {
    tipo: 'lancamento',
    params: [
      userId,
      hoje,
      parsed.descricao,
      parsed.valor,
      parsed.acao === 'entrada' ? 'Entrada' : 'Saída',
      parsed.contaOrigem?.id || null,
      null,                      // conta_destino
      parsed.categoria?.id || null,
      parsed.categoria?.nome || 'Outros',
      null,                      // subcategoria
      parsed.forma,
      'Pago',
      parsed.competencia,
      'Telegram',
      null,                      // observação
    ],
  };
}

// ─────────────────────────────────────────────
// SALVAR LANÇAMENTO NO BANCO
// Usa função SQL para transferências, INSERT direto para outros
// ─────────────────────────────────────────────
async function salvarParsed(db, parsed, userId) {
  const insert = parsedParaInsert(parsed, userId);

  if (insert.tipo === 'transferencia') {
    const { rows } = await db.query(
      `SELECT * FROM registrar_transferencia($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      insert.params
    );
    return { tipo: 'transferencia', resultado: rows[0] };
  }

  const { rows } = await db.query(
    `INSERT INTO lancamentos
      (user_id, data, descricao, valor, tipo,
       conta_origem_id, conta_destino_id,
       categoria_id, categoria_nome, subcategoria,
       forma_pagamento, status, competencia, fonte, observacao)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    insert.params
  );
  return { tipo: 'lancamento', resultado: rows[0] };
}

// ─────────────────────────────────────────────
// TESTES UNITÁRIOS INTERNOS
// Execute: node src/nlp.js para rodar
// ─────────────────────────────────────────────
async function testar() {
  console.log('🧪 Testando parser NLP (sem banco — contexto mock)\n');

  // Contexto mock para testes sem banco
  const contasMock = [
    { id: 'uuid-nu',    nome: 'Nubank CC',       tipo: 'Conta Corrente', banco: 'Nubank' },
    { id: 'uuid-mp',    nome: 'Mercado Pago CC',  tipo: 'Conta Corrente', banco: 'Mercado Pago' },
    { id: 'uuid-cef',   nome: 'Caixa CEF',        tipo: 'Conta Corrente', banco: 'Caixa' },
    { id: 'uuid-c6',    nome: 'C6 Bank CC',        tipo: 'Conta Corrente', banco: 'C6 Bank' },
    { id: 'uuid-cof',   nome: 'Cofrinho MP',       tipo: 'Reserva',        banco: 'Mercado Pago' },
  ];

  const categoriasMock = [
    { id: 'cat-ali', nome: 'Alimentação',   tipo: 'saida'  },
    { id: 'cat-tra', nome: 'Transporte',    tipo: 'saida'  },
    { id: 'cat-sau', nome: 'Saúde',         tipo: 'saida'  },
    { id: 'cat-rec', nome: 'Receita Extra', tipo: 'entrada'},
    { id: 'cat-out', nome: 'Outros',        tipo: 'ambos'  },
  ];

  const aliases = construirAliases(contasMock);
  const contaPadrao = contasMock[0];

  const casos = [
    'paguei 50 de gasolina débito nubank',
    'gastei R$ 32,50 no ifood c6',
    'recebi 2000 da raquel',
    'transferi 500 da caixa para o nubank',
    'fiz um pix de 100 do mp pro c6',
    'paguei 8850 fatura nubank',
    'entrou 556 do vale alimentação',
    '/saldo',
    '/faturas',
    'isso aqui não faz sentido',
    'paguei 0 de nada',
    'gastei 1500 roupa mercado pago credito',
  ];

  for (const texto of casos) {
    const tipo = detectarTipo(texto);
    const valor = extrairValor(texto);
    const forma = extrairForma(texto);
    const conta = extrairConta(texto, aliases, contaPadrao);
    const cat   = tipo !== 'transferencia' ? inferirCategoria(texto, categoriasMock) : null;

    console.log(`Entrada: "${texto}"`);
    console.log(`  tipo=${tipo} | valor=${valor} | forma=${forma}`);
    console.log(`  conta=${conta?.nome} | cat=${cat?.nome}`);

    if (tipo === 'transferencia') {
      const pares = parsearTransferencia(texto, valor, aliases, contaPadrao);
      console.log(`  transf: ${pares?.contaOrigem?.nome} → ${pares?.contaDestino?.nome}`);
    }
    console.log('');
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  parsearMensagem,
  formatarConfirmacao,
  salvarParsed,
  invalidarCache,
  // Exportar helpers para testes
  extrairValor,
  extrairConta,
  extrairForma,
  inferirCategoria,
  detectarTipo,
  construirAliases,
};

// Rodar testes se executado diretamente
if (require.main === module) testar();
