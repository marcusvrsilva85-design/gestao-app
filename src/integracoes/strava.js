// ============================================================
// INTEGRAÇÃO STRAVA — Gestão Pessoal
// Arquivo: src/integracoes/strava.js
// ============================================================

'use strict';

const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const CLIENT_ID     = () => process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = () => process.env.STRAVA_CLIENT_SECRET;
const VERIFY_TOKEN  = () => process.env.STRAVA_VERIFY_TOKEN;
const STRAVA_API    = 'https://www.strava.com/api/v3';

// ─────────────────────────────────────────────
// MAPEAMENTO: tipo Strava → tipo do nosso app
// ─────────────────────────────────────────────
const TIPO_ATIVIDADE = {
  Ride:               'Ciclismo',
  VirtualRide:        'Ciclismo',
  MountainBikeRide:   'Ciclismo',
  Run:                'Corrida',
  VirtualRun:         'Corrida',
  Swim:               'Natação',
  WeightTraining:     'Musculação',
  Workout:            'HIIT',
  Crossfit:           'HIIT',
  Hike:               'Outro',
  Walk:               'Outro',
  Yoga:               'Mobilidade',
  Pilates:            'Mobilidade',
  Soccer:             'Outro',
  Tennis:             'Outro',
  Rowing:             'Outro',
};

// ─────────────────────────────────────────────
// GERAR URL DE AUTORIZAÇÃO OAUTH
// ─────────────────────────────────────────────
function gerarUrlAutorizacao(userId) {
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'http://localhost:3000';

  const redirectUri = `${baseUrl}/webhook/strava/callback`;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope:         'activity:read_all',
    state:         userId, // passa o user_id para recuperar no callback
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

// ─────────────────────────────────────────────
// TROCAR CODE POR TOKENS (callback OAuth)
// ─────────────────────────────────────────────
async function trocarCodePorTokens(code) {
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }),
  });
  if (!resp.ok) throw new Error('Falha ao trocar code por tokens');
  return resp.json();
}

// ─────────────────────────────────────────────
// RENOVAR ACCESS TOKEN (expira a cada 6 horas)
// ─────────────────────────────────────────────
async function renovarToken(refreshToken) {
  const resp = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error('Falha ao renovar token Strava');
  return resp.json();
}

// ─────────────────────────────────────────────
// BUSCAR DETALHES DE UMA ATIVIDADE
// ─────────────────────────────────────────────
async function buscarAtividade(activityId, accessToken) {
  const resp = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`Erro ao buscar atividade ${activityId}`);
  return resp.json();
}

// ─────────────────────────────────────────────
// GARANTIR TOKEN VÁLIDO
// Renova automaticamente se estiver expirado
// ─────────────────────────────────────────────
async function garantirTokenValido(db, integracao) {
  const agora = new Date();
  const expira = new Date(integracao.token_expires_at);

  // Se expira em menos de 10 minutos, renova
  if (expira - agora < 10 * 60 * 1000) {
    console.log(`[Strava] Renovando token para user ${integracao.user_id}`);
    const novos = await renovarToken(integracao.refresh_token);

    await db.query(
      `UPDATE integracoes_strava
       SET access_token=$1, refresh_token=$2, token_expires_at=$3
       WHERE user_id=$4`,
      [
        novos.access_token,
        novos.refresh_token,
        new Date(novos.expires_at * 1000).toISOString(),
        integracao.user_id,
      ]
    );

    return novos.access_token;
  }

  return integracao.access_token;
}

// ─────────────────────────────────────────────
// CONVERTER ATIVIDADE STRAVA → treino_sessoes
// ─────────────────────────────────────────────
function converterAtividade(atividade) {
  const tipo = TIPO_ATIVIDADE[atividade.sport_type]
    || TIPO_ATIVIDADE[atividade.type]
    || 'Outro';

  // Calcular zona predominante pela FC média
  let zona = null;
  if (atividade.average_heartrate) {
    const fc = atividade.average_heartrate;
    if (fc < 114)      zona = 'Z1';
    else if (fc < 133) zona = 'Z2';
    else if (fc < 152) zona = 'Z3';
    else if (fc < 171) zona = 'Z4';
    else               zona = 'Z5';
  }

  const dataSessao = atividade.start_date_local
    ? atividade.start_date_local.split('T')[0]
    : new Date().toISOString().split('T')[0];

  return {
    data_sessao:        dataSessao,
    tipo,
    nome:               atividade.name || tipo,
    duracao_min:        atividade.elapsed_time
                          ? Math.round(atividade.elapsed_time / 60)
                          : null,
    calorias:           atividade.calories || null,
    fc_media:           atividade.average_heartrate
                          ? Math.round(atividade.average_heartrate)
                          : null,
    fc_max:             atividade.max_heartrate
                          ? Math.round(atividade.max_heartrate)
                          : null,
    zona_predominante:  zona,
    distancia_km:       atividade.distance
                          ? parseFloat((atividade.distance / 1000).toFixed(2))
                          : null,
    notas:              `Importado do Strava · ${atividade.sport_type}${
                          atividade.total_elevation_gain
                            ? ` · ${Math.round(atividade.total_elevation_gain)}m de elevação`
                            : ''
                        }`,
    fonte:              'Strava',
    strava_activity_id: atividade.id,
  };
}

// ─────────────────────────────────────────────
// SALVAR ATIVIDADE NO BANCO
// ─────────────────────────────────────────────
async function salvarAtividade(db, userId, atividade) {
  const sessao = converterAtividade(atividade);

  // Verificar se já foi importada (evitar duplicata)
  const { rows: [existe] } = await db.query(
    `SELECT id FROM treino_sessoes
     WHERE user_id=$1 AND notas LIKE $2`,
    [userId, `%${sessao.strava_activity_id}%`]
  );
  if (existe) {
    console.log(`[Strava] Atividade ${sessao.strava_activity_id} já importada`);
    return null;
  }

  const { rows: [salva] } = await db.query(
    `INSERT INTO treino_sessoes
      (user_id, data_sessao, tipo, nome, duracao_min, calorias,
       fc_media, fc_max, zona_predominante, distancia_km, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      userId,
      sessao.data_sessao,
      sessao.tipo,
      sessao.nome,
      sessao.duracao_min,
      sessao.calorias,
      sessao.fc_media,
      sessao.fc_max,
      sessao.zona_predominante,
      sessao.distancia_km,
      sessao.notas,
    ]
  );

  console.log(`[Strava] Atividade salva: ${sessao.nome} (${sessao.tipo}) — user ${userId}`);
  return salva;
}

// ─────────────────────────────────────────────
// REGISTRAR WEBHOOK NO STRAVA
// Chamar uma vez para ativar as notificações
// ─────────────────────────────────────────────
async function registrarWebhook(callbackUrl) {
  const resp = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      callback_url:  callbackUrl,
      verify_token:  VERIFY_TOKEN,
    }),
  });
  const data = await resp.json();
  console.log('[Strava] Registro webhook:', data);
  return data;
}

module.exports = {
  gerarUrlAutorizacao,
  trocarCodePorTokens,
  buscarAtividade,
  garantirTokenValido,
  salvarAtividade,
  registrarWebhook,
  converterAtividade,
};