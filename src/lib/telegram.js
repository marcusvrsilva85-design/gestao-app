// ============================================================
// GESTÃO PESSOAL — Telegram helpers
// Arquivo: src/lib/telegram.js
// ============================================================

'use strict';

const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const BASE   = () => `https://api.telegram.org/bot${TOKEN()}`;

// ─────────────────────────────────────────────
// ENVIAR MENSAGEM
// ─────────────────────────────────────────────
async function enviar(chatId, texto, opcoes = {}) {
  if (!TOKEN()) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN não configurado');
    return null;
  }
  try {
    const resp = await fetch(`${BASE()}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
        text:       texto,
        parse_mode: 'HTML',
        ...opcoes,
      }),
    });
    return await resp.json();
  } catch (err) {
    console.error('[Telegram] Erro ao enviar mensagem:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// REGISTRAR WEBHOOK
// ─────────────────────────────────────────────
async function registrarWebhook(urlPublica) {
  if (!TOKEN() || !urlPublica) return false;
  try {
    const url = `${urlPublica}/webhook/telegram`;
    const resp = await fetch(`${BASE()}/setWebhook?url=${encodeURIComponent(url)}`);
    const data = await resp.json();
    if (data.ok) {
      console.log(`✅ Telegram webhook registrado: ${url}`);
    } else {
      console.error('❌ Falha ao registrar webhook:', data.description);
    }
    return data.ok;
  } catch (err) {
    console.error('[Telegram] Erro ao registrar webhook:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// OBTER INFO DO WEBHOOK (diagnóstico)
// ─────────────────────────────────────────────
async function infoWebhook() {
  if (!TOKEN()) return null;
  const resp = await fetch(`${BASE()}/getWebhookInfo`);
  return resp.json();
}

// ─────────────────────────────────────────────
// MENSAGENS PADRÃO DO SISTEMA
// ─────────────────────────────────────────────
function msgAjuda() {
  return [
    '🤖 <b>COMANDOS DISPONÍVEIS</b>',
    '',
    '<b>Registrar saída:</b>',
    '  paguei 50 de gasolina débito nubank',
    '  gastei 30 no mercado c6',
    '  comprei 120 de roupa crédito',
    '',
    '<b>Registrar entrada:</b>',
    '  recebi 2000 da raquel',
    '  entrou 3500 do salário',
    '',
    '<b>Transferência entre contas:</b>',
    '  transferi 500 da caixa para o nubank',
    '  fiz um pix de 100 do mp pro c6',
    '',
    '<b>Consultas:</b>',
    '  /saldo — saldos de todas as contas',
    '  /mes — resumo do mês atual',
    '  /faturas — faturas pendentes',
    '  /ajuda — esta mensagem',
  ].join('\n');
}

function msgNaoConectado() {
  return [
    '👋 Olá! Para usar o bot, siga os passos:',
    '',
    '1. Acesse o app',
    '2. Vá em Configurações → Telegram',
    '3. Clique em "Conectar bot"',
    '4. Cole seu Chat ID',
    '',
    'Seu Chat ID é o número que aparece em:',
    't.me/userinfobot',
  ].join('\n');
}

function msgErro(detalhe = '') {
  return `❌ Erro ao processar${detalhe ? ': ' + detalhe : ''}.\n\nTente novamente ou use /ajuda.`;
}

// ─────────────────────────────────────────────
// FORMATAR MOEDA
// ─────────────────────────────────────────────
function fmtMoeda(valor) {
  return 'R$ ' + parseFloat(valor || 0)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ─────────────────────────────────────────────
// FORMATAR SALDOS
// ─────────────────────────────────────────────
function fmtSaldos(saldos, nomeUsuario = '') {
  const contasCorrentes = saldos.filter(s =>
    !['Milhas', 'Milhas/Pontos'].includes(s.tipo)
  );
  const milhas = saldos.filter(s =>
    ['Milhas', 'Milhas/Pontos'].includes(s.tipo)
  );

  const linhas = contasCorrentes.map(s => {
    const v = parseFloat(s.saldo_atual);
    const emoji = v < 0 ? '🔴' : v < 50 ? '⚠️' : '✅';
    return `${emoji} <b>${s.nome}</b>: ${fmtMoeda(v)}`;
  });

  const total = contasCorrentes
    .reduce((a, b) => a + parseFloat(b.saldo_atual), 0);

  const partes = [
    nomeUsuario
      ? `💰 <b>SALDOS — ${nomeUsuario}</b>`
      : '💰 <b>SALDOS ATUAIS</b>',
    '',
    ...linhas,
    '',
    `<b>Total líquido: ${fmtMoeda(total)}</b>`,
  ];

  if (milhas.length > 0) {
    partes.push('');
    partes.push('<i>Milhas/Pontos:</i>');
    milhas.forEach(s => {
      partes.push(`  • ${s.nome}: ${fmtMoeda(s.saldo_atual)}`);
    });
  }

  partes.push(`<i>Atualizado: ${new Date().toLocaleString('pt-BR')}</i>`);
  return partes.join('\n');
}

// ─────────────────────────────────────────────
// FORMATAR RESUMO DO MÊS
// ─────────────────────────────────────────────
function fmtResumoMes(resumo, competencia) {
  const ent = parseFloat(resumo.total_entradas || 0);
  const sai = parseFloat(resumo.total_saidas   || 0);
  const res = ent - sai;
  const emojiRes = res >= 0 ? '✅' : '⚠️';

  return [
    `📊 <b>RESUMO ${competencia}</b>`,
    '',
    `✅ Entradas:  ${fmtMoeda(ent)}`,
    `💸 Saídas:    ${fmtMoeda(sai)}`,
    `${emojiRes} Resultado: ${fmtMoeda(res)}`,
    '',
    `<i>${resumo.qtd_lancamentos || 0} lançamentos no período</i>`,
  ].join('\n');
}

// ─────────────────────────────────────────────
// FORMATAR FATURAS PENDENTES
// ─────────────────────────────────────────────
function fmtFaturas(faturas) {
  if (!faturas.length) return '✅ Nenhuma fatura pendente!';

  const linhas = faturas.map(f => {
    const emoji = f.alerta === 'atrasada' ? '🔴'
                : f.alerta === 'urgente'  ? '🚨'
                : f.alerta === 'proxima'  ? '⚠️' : '📅';
    const dias = f.dias_ate_vencimento;
    const prazo = dias < 0
      ? `${Math.abs(dias)} dias em atraso`
      : dias === 0 ? 'vence hoje'
      : `${dias} dias`;
    return `${emoji} <b>${f.conta_nome}</b>\n   ${fmtMoeda(f.valor_total)} · ${prazo} · ${f.vencimento}`;
  });

  const total = faturas.reduce((a, b) => a + parseFloat(b.valor_total), 0);

  return [
    `💳 <b>FATURAS PENDENTES (${faturas.length})</b>`,
    '',
    linhas.join('\n'),
    '',
    `<b>Total: ${fmtMoeda(total)}</b>`,
  ].join('\n');
}

// ─────────────────────────────────────────────
// FORMATAR CONFIRMAÇÃO DE LANÇAMENTO
// ─────────────────────────────────────────────
function fmtConfirmacao(parsed) {
  const emoji = {
    entrada:       '✅',
    saida:         '💸',
    transferencia: '🔄',
  }[parsed.acao] || '📝';

  const valor = fmtMoeda(parsed.valor);

  if (parsed.acao === 'transferencia') {
    return [
      `${emoji} <b>Transferência registrada!</b>`,
      '',
      `De:    <b>${parsed.contaOrigem.nome}</b>`,
      `Para:  <b>${parsed.contaDestino.nome}</b>`,
      `Valor: ${valor}`,
      `Forma: ${parsed.forma}`,
      `Mês:   ${parsed.competencia}`,
    ].join('\n');
  }

  const linhas = [
    `${emoji} <b>Lançamento registrado!</b>`,
    '',
    `<b>${parsed.descricao}</b>`,
    `Valor: ${valor}`,
  ];

  if (parsed.contaOrigem) linhas.push(`Conta: ${parsed.contaOrigem.nome}`);
  if (parsed.categoria?.nome) linhas.push(`Cat:   ${parsed.categoria.nome}`);
  if (parsed.forma) linhas.push(`Forma: ${parsed.forma}`);
  linhas.push(`Mês:   ${parsed.competencia}`);

  if (parsed.confianca === 'media') {
    linhas.push('');
    linhas.push('⚠️ <i>Conta não identificada — usando padrão</i>');
  }

  return linhas.join('\n');
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  enviar,
  registrarWebhook,
  infoWebhook,
  msgAjuda,
  msgNaoConectado,
  msgErro,
  fmtMoeda,
  fmtSaldos,
  fmtResumoMes,
  fmtFaturas,
  fmtConfirmacao,
};
