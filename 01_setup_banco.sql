-- ============================================================
-- GESTÃO PESSOAL — Setup banco multi-usuário
-- Versão: 1.0.0 — Produto público
-- Execute no Supabase → SQL Editor, bloco por bloco
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. EXTENSÕES
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────────
-- 1. USUÁRIOS
-- Cada usuário tem todos os dados isolados por user_id
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  senha_hash      TEXT NOT NULL,        -- bcrypt, nunca texto puro
  telegram_chat_id TEXT UNIQUE,         -- opcional — para bot Telegram
  telegram_ativo  BOOLEAN DEFAULT false,
  plano           TEXT DEFAULT 'free',  -- 'free' | 'pro'
  ativo           BOOLEAN DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE usuarios IS 'Usuários do sistema — cada um tem dados 100% isolados';
COMMENT ON COLUMN usuarios.telegram_chat_id IS 'ID do chat Telegram — preenchido quando usuário conecta o bot';

-- ─────────────────────────────────────────────
-- 2. CONTAS / CARTEIRAS
-- Cada usuário cadastra suas próprias contas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'Conta Corrente',
  -- 'Conta Corrente' | 'Conta Poupança' | 'Carteira Digital'
  -- 'Cartão de Crédito' | 'Investimento' | 'Milhas/Pontos' | 'Outro'
  banco          TEXT,
  cor_hex        TEXT DEFAULT 'CCCCCC',
  saldo_inicial  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ativa          BOOLEAN DEFAULT true,
  criado_em      TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, nome)  -- mesmo usuário não pode ter 2 contas com mesmo nome
);

-- ─────────────────────────────────────────────
-- 3. CATEGORIAS
-- Categorias padrão (globais) + categorias personalizadas por usuário
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID REFERENCES usuarios(id) ON DELETE CASCADE,
  -- NULL = categoria padrão do sistema (visível para todos)
  nome      TEXT NOT NULL,
  cor_hex   TEXT DEFAULT 'AAAAAA',
  icone     TEXT DEFAULT 'circle',
  tipo      TEXT DEFAULT 'ambos', -- 'entrada' | 'saida' | 'ambos'
  ativa     BOOLEAN DEFAULT true
);

-- ─────────────────────────────────────────────
-- 4. LANÇAMENTOS FINANCEIROS
-- Núcleo do sistema — todas as transações do usuário
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lancamentos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data                  DATE NOT NULL,
  descricao             TEXT NOT NULL,
  valor                 DECIMAL(12,2) NOT NULL CHECK (valor >= 0),
  tipo                  TEXT NOT NULL,
  -- 'Saída' | 'Entrada' | 'Transferência Saída' | 'Transferência Entrada'
  conta_origem_id       UUID REFERENCES contas(id) ON DELETE RESTRICT,
  conta_destino_id      UUID REFERENCES contas(id) ON DELETE RESTRICT,
  categoria_id          UUID REFERENCES categorias(id),
  categoria_nome        TEXT,           -- cache do nome para queries rápidas
  subcategoria          TEXT,
  forma_pagamento       TEXT,
  -- 'Pix' | 'Débito' | 'Crédito' | 'Boleto' | 'Dinheiro' | 'TED' | 'Outro'
  status                TEXT DEFAULT 'Pago',
  -- 'Pago' | 'Pendente' | 'Agendado' | 'Cancelado'
  competencia           TEXT NOT NULL,  -- 'MM/AAAA'
  fonte                 TEXT DEFAULT 'App',
  -- 'App' | 'Telegram' | 'Gmail' | 'CSV' | 'API'
  transferencia_par_id  UUID REFERENCES lancamentos(id) ON DELETE SET NULL,
  gmail_message_id      TEXT,
  observacao            TEXT,
  criado_em             TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 5. FATURAS DE CARTÃO
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faturas (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  conta_id                UUID NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  descricao               TEXT NOT NULL,
  valor_total             DECIMAL(12,2) NOT NULL,
  vencimento              DATE NOT NULL,
  status                  TEXT DEFAULT 'Pendente',
  -- 'Pendente' | 'Pago' | 'Atrasado' | 'Parcial'
  mes_referencia          TEXT,
  lancamento_pagamento_id UUID REFERENCES lancamentos(id),
  observacao              TEXT,
  criado_em               TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em           TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 6. SAÚDE — COMPOSIÇÃO CORPORAL
-- Medições periódicas (Galaxy Watch, balança smart etc.)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saude_biometria (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_medicao      DATE NOT NULL,
  peso_kg           DECIMAL(5,2),
  altura_cm         DECIMAL(5,1),
  gordura_pct       DECIMAL(4,1),
  musculo_kg        DECIMAL(5,2),
  agua_pct          DECIMAL(4,1),
  imc               DECIMAL(4,1),
  tmb_kcal          INTEGER,          -- taxa metabólica basal
  fonte             TEXT DEFAULT 'Manual',
  -- 'Manual' | 'Galaxy Watch' | 'Balança Smart' | 'App'
  observacao        TEXT,
  criado_em         TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 7. SAÚDE — EXAMES LABORATORIAIS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saude_exames (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_exame    DATE NOT NULL,
  nome          TEXT NOT NULL,         -- 'Anti-TPO' | 'HbA1c' | 'Colesterol Total'
  resultado     TEXT NOT NULL,         -- valor como texto (ex: '95,30 UI/mL')
  valor_numerico DECIMAL(10,3),        -- para cálculos e gráficos
  unidade       TEXT,                  -- 'UI/mL' | '%' | 'mg/dL'
  ref_min       DECIMAL(10,3),         -- valor mínimo de referência
  ref_max       DECIMAL(10,3),         -- valor máximo de referência
  status_alerta TEXT DEFAULT 'normal',
  -- 'normal' | 'atencao' | 'critico'
  laboratorio   TEXT,
  medico        TEXT,
  observacao    TEXT,
  criado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 8. TREINO — CONFIGURAÇÃO DO CICLO
-- Permite qualquer escala de trabalho (6x2, 5x2, 4x3 etc.)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treino_ciclo_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL DEFAULT 'Meu Ciclo',
  dias_trabalho   INTEGER NOT NULL DEFAULT 6,  -- ex: 6 em 6x2
  dias_folga      INTEGER NOT NULL DEFAULT 2,  -- ex: 2 em 6x2
  data_inicio     DATE NOT NULL,               -- data do Dia 1 do ciclo
  ativo           BOOLEAN DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 9. TREINO — PLANO POR DIA DO CICLO
-- Usuário define o que faz em cada dia do ciclo
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treino_plano (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ciclo_id        UUID NOT NULL REFERENCES treino_ciclo_config(id) ON DELETE CASCADE,
  dia_numero      INTEGER NOT NULL,   -- 1 a N (N = dias_trabalho + dias_folga)
  tipo_dia        TEXT,               -- 'Trabalho' | 'Folga'
  atividade       TEXT,               -- 'Ciclismo + Musculação' | 'Descanso'
  treino_nome     TEXT,               -- 'Treino A' | 'VO2 Max' | 'Cardio Z2'
  duracao_min     INTEGER,
  zona_treino     TEXT,               -- 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'
  objetivo        TEXT,
  notas_nutrição  TEXT,               -- alertas nutricionais do dia
  criado_em       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ciclo_id, dia_numero)
);

-- ─────────────────────────────────────────────
-- 10. TREINO — REGISTRO DE SESSÕES REALIZADAS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treino_sessoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_sessao     DATE NOT NULL,
  tipo            TEXT NOT NULL,      -- 'Musculação' | 'Ciclismo' | 'Corrida' | 'Outro'
  nome            TEXT,               -- 'Treino A — Potência'
  duracao_min     INTEGER,
  calorias        INTEGER,
  fc_media        INTEGER,            -- frequência cardíaca média
  fc_max          INTEGER,
  zona_predominante TEXT,
  distancia_km    DECIMAL(6,2),       -- para ciclismo/corrida
  notas           TEXT,
  humor           TEXT,               -- 'Ótimo' | 'Bom' | 'Regular' | 'Ruim'
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 11. NUTRIÇÃO — REGISTRO DIÁRIO
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutricao_diario (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data_registro   DATE NOT NULL,
  refeicao        TEXT NOT NULL,
  -- 'Café da Manhã' | 'Lanche' | 'Almoço' | 'Pré-Treino' | 'Pós-Treino' | 'Jantar' | 'Ceia'
  descricao       TEXT,
  calorias_kcal   INTEGER,
  proteina_g      DECIMAL(6,1),
  carboidrato_g   DECIMAL(6,1),
  gordura_g       DECIMAL(6,1),
  fibra_g         DECIMAL(6,1),
  agua_ml         INTEGER,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 12. METAS DO USUÁRIO
-- Financeiras, de saúde e treino — cada um define as suas
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo          TEXT NOT NULL,      -- 'financeiro' | 'saude' | 'treino' | 'nutricao'
  nome            TEXT NOT NULL,      -- 'Peso meta' | 'Gordura meta' | 'Economizar X'
  valor_meta      DECIMAL(12,2),
  unidade         TEXT,               -- 'kg' | '%' | 'R$' | 'km'
  data_limite     DATE,
  ativa           BOOLEAN DEFAULT true,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 13. NOTIFICAÇÕES / ALERTAS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificacoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,
  -- 'fatura_vencendo' | 'saldo_baixo' | 'meta_atingida' | 'lembrete_treino'
  titulo          TEXT NOT NULL,
  mensagem        TEXT,
  lida            BOOLEAN DEFAULT false,
  canal           TEXT DEFAULT 'app', -- 'app' | 'telegram' | 'email' | 'push'
  enviada_em      TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 14. LOG DE IMPORTAÇÕES GMAIL
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_gmail (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  remetente        TEXT,
  assunto          TEXT,
  banco_detectado  TEXT,
  status           TEXT DEFAULT 'processado',
  lancamento_id    UUID REFERENCES lancamentos(id),
  erro_msg         TEXT,
  processado_em    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, gmail_message_id)
);

-- ─────────────────────────────────────────────
-- 15. PUSH TOKENS (dispositivos dos usuários)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  plataforma   TEXT,   -- 'android' | 'ios'
  ativo        BOOLEAN DEFAULT true,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 16. ÍNDICES DE PERFORMANCE
-- ─────────────────────────────────────────────

-- Isolamento por usuário (todas as queries filtram por user_id primeiro)
CREATE INDEX IF NOT EXISTS idx_contas_user          ON contas(user_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_user     ON lancamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_faturas_user         ON faturas(user_id);
CREATE INDEX IF NOT EXISTS idx_biometria_user       ON saude_biometria(user_id);
CREATE INDEX IF NOT EXISTS idx_exames_user          ON saude_exames(user_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_user         ON treino_sessoes(user_id);
CREATE INDEX IF NOT EXISTS idx_nutricao_user        ON nutricao_diario(user_id);

-- Performance das queries financeiras
CREATE INDEX IF NOT EXISTS idx_lanc_user_conta_orig
  ON lancamentos(user_id, conta_origem_id, status);
CREATE INDEX IF NOT EXISTS idx_lanc_user_conta_dest
  ON lancamentos(user_id, conta_destino_id, status);
CREATE INDEX IF NOT EXISTS idx_lanc_user_competencia
  ON lancamentos(user_id, competencia);
CREATE INDEX IF NOT EXISTS idx_lanc_user_data
  ON lancamentos(user_id, data DESC);

-- Deduplicação Gmail por usuário
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_dedup
  ON importacoes_gmail(user_id, gmail_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lanc_gmail
  ON lancamentos(user_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- Busca por texto
CREATE INDEX IF NOT EXISTS idx_lanc_descricao_trgm
  ON lancamentos USING gin(descricao gin_trgm_ops);

-- Faturas por vencimento
CREATE INDEX IF NOT EXISTS idx_faturas_vencimento
  ON faturas(user_id, vencimento, status);

-- Biometria por data
CREATE INDEX IF NOT EXISTS idx_biometria_data
  ON saude_biometria(user_id, data_medicao DESC);

-- ─────────────────────────────────────────────
-- 17. ROW LEVEL SECURITY (RLS)
-- Garante no banco que cada usuário só vê seus dados
-- ─────────────────────────────────────────────
ALTER TABLE contas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE saude_biometria   ENABLE ROW LEVEL SECURITY;
ALTER TABLE saude_exames      ENABLE ROW LEVEL SECURITY;
ALTER TABLE treino_ciclo_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE treino_plano      ENABLE ROW LEVEL SECURITY;
ALTER TABLE treino_sessoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutricao_diario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes      ENABLE ROW LEVEL SECURITY;

-- Política: cada usuário só acessa os próprios registros
-- (O backend passa o user_id via app.set_config)
DO $$
DECLARE
  tbls TEXT[] := ARRAY[
    'contas','lancamentos','faturas','saude_biometria',
    'saude_exames','treino_ciclo_config','treino_plano',
    'treino_sessoes','nutricao_diario','metas','notificacoes'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.user_id'')::UUID)',
      'policy_user_isolado_' || t, t
    );
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────
-- 18. VIEWS (não contêm user_id fixo — filtro via RLS)
-- ─────────────────────────────────────────────

-- View: saldo atual de todas as contas do usuário corrente
CREATE OR REPLACE VIEW v_saldos AS
SELECT
  c.id,
  c.user_id,
  c.nome,
  c.tipo,
  c.banco,
  c.cor_hex,
  c.saldo_inicial,
  COALESCE(SUM(CASE
    WHEN l.tipo IN ('Entrada','Transferência Entrada') THEN l.valor ELSE 0
  END), 0) AS total_entradas,
  COALESCE(SUM(CASE
    WHEN l.tipo IN ('Saída','Transferência Saída') THEN l.valor ELSE 0
  END), 0) AS total_saidas,
  c.saldo_inicial
    + COALESCE(SUM(CASE
        WHEN l.tipo IN ('Entrada','Transferência Entrada') THEN l.valor ELSE 0
      END), 0)
    - COALESCE(SUM(CASE
        WHEN l.tipo IN ('Saída','Transferência Saída') THEN l.valor ELSE 0
      END), 0)
  AS saldo_atual
FROM contas c
LEFT JOIN lancamentos l
  ON (l.conta_origem_id = c.id OR l.conta_destino_id = c.id)
  AND l.status = 'Pago'
  AND l.user_id = c.user_id
WHERE c.ativa = true
GROUP BY c.id, c.user_id, c.nome, c.tipo, c.banco, c.cor_hex, c.saldo_inicial;

-- View: faturas pendentes com alerta por dias
CREATE OR REPLACE VIEW v_faturas_pendentes AS
SELECT
  f.id, f.user_id,
  c.nome AS conta_nome, c.cor_hex,
  f.descricao, f.valor_total, f.vencimento,
  f.status, f.mes_referencia,
  (f.vencimento - CURRENT_DATE) AS dias_ate_vencimento,
  CASE
    WHEN f.vencimento < CURRENT_DATE       THEN 'atrasada'
    WHEN f.vencimento <= CURRENT_DATE + 2  THEN 'urgente'
    WHEN f.vencimento <= CURRENT_DATE + 7  THEN 'proxima'
    ELSE 'ok'
  END AS alerta
FROM faturas f
JOIN contas c ON f.conta_id = c.id
WHERE f.status IN ('Pendente','Atrasado')
ORDER BY f.vencimento ASC;

-- View: última medição de biometria por usuário
CREATE OR REPLACE VIEW v_biometria_atual AS
SELECT DISTINCT ON (user_id)
  user_id, data_medicao, peso_kg, gordura_pct,
  musculo_kg, agua_pct, imc, tmb_kcal, fonte
FROM saude_biometria
ORDER BY user_id, data_medicao DESC;

-- ─────────────────────────────────────────────
-- 19. FUNÇÃO: registrar transferência atômica
-- (reutiliza a mesma lógica — agora com user_id)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION registrar_transferencia(
  p_user_id       UUID,
  p_data          DATE,
  p_descricao     TEXT,
  p_valor         DECIMAL,
  p_conta_origem  UUID,
  p_conta_destino UUID,
  p_forma         TEXT DEFAULT 'Pix',
  p_competencia   TEXT DEFAULT NULL,
  p_fonte         TEXT DEFAULT 'App',
  p_observacao    TEXT DEFAULT NULL
)
RETURNS TABLE(id_saida UUID, id_entrada UUID)
LANGUAGE plpgsql AS $$
DECLARE
  v_id_saida UUID := uuid_generate_v4();
  v_id_ent   UUID := uuid_generate_v4();
  v_comp     TEXT;
BEGIN
  v_comp := COALESCE(p_competencia,
    LPAD(EXTRACT(MONTH FROM p_data)::TEXT, 2, '0')
    || '/' || EXTRACT(YEAR FROM p_data)::TEXT
  );

  INSERT INTO lancamentos (
    id, user_id, data, descricao, valor, tipo,
    conta_origem_id, conta_destino_id,
    categoria_nome, forma_pagamento, status,
    competencia, fonte, transferencia_par_id, observacao
  ) VALUES (
    v_id_saida, p_user_id, p_data, p_descricao, p_valor,
    'Transferência Saída', p_conta_origem, p_conta_destino,
    'Transferência', p_forma, 'Pago',
    v_comp, p_fonte, v_id_ent, p_observacao
  ), (
    v_id_ent, p_user_id, p_data, p_descricao, p_valor,
    'Transferência Entrada', p_conta_origem, p_conta_destino,
    'Transferência', p_forma, 'Pago',
    v_comp, p_fonte, v_id_saida, p_observacao
  );

  RETURN QUERY SELECT v_id_saida, v_id_ent;
END;
$$;

-- ─────────────────────────────────────────────
-- 20. TRIGGER: atualizar timestamp automaticamente
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.atualizado_em = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usuarios_updated   BEFORE UPDATE ON usuarios   FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();
CREATE TRIGGER trg_contas_updated     BEFORE UPDATE ON contas     FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();
CREATE TRIGGER trg_lancamentos_upd    BEFORE UPDATE ON lancamentos FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();
CREATE TRIGGER trg_faturas_updated    BEFORE UPDATE ON faturas    FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();

-- ─────────────────────────────────────────────
-- 21. CATEGORIAS PADRÃO DO SISTEMA
-- Disponíveis para todos os usuários (user_id NULL)
-- ─────────────────────────────────────────────
INSERT INTO categorias (user_id, nome, cor_hex, icone, tipo) VALUES
  (NULL, 'Alimentação',       'E8A317', 'utensils',     'saida'),
  (NULL, 'Transporte',        '795548', 'car',           'saida'),
  (NULL, 'Moradia',           'F39C12', 'home',          'saida'),
  (NULL, 'Saúde',             'E91E63', 'heart',         'saida'),
  (NULL, 'Educação',          '3498DB', 'book',          'saida'),
  (NULL, 'Lazer',             '9B59B6', 'smile',         'saida'),
  (NULL, 'Assinatura',        '8E44AD', 'repeat',        'saida'),
  (NULL, 'Vestuário',         'E74C3C', 'shirt',         'saida'),
  (NULL, 'Fatura Cartão',     'C0392B', 'credit-card',   'saida'),
  (NULL, 'Dívida/Encargo',    'FF5733', 'alert-circle',  'saida'),
  (NULL, 'Investimento',      '27AE60', 'trending-up',   'ambos'),
  (NULL, 'Reserva/Cofrinho',  '2980B9', 'piggy-bank',    'ambos'),
  (NULL, 'Transferência',     '607D8B', 'arrow-right',   'ambos'),
  (NULL, 'Receita Salário',   '1ABC9C', 'briefcase',     'entrada'),
  (NULL, 'Receita Extra',     '2ECC71', 'plus-circle',   'entrada'),
  (NULL, 'Outros',            '95A5A6', 'circle',        'ambos')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- 22. VERIFICAÇÃO FINAL
-- ─────────────────────────────────────────────
SELECT 'usuarios'             AS tabela, COUNT(*) AS registros FROM usuarios
UNION ALL SELECT 'contas',              COUNT(*) FROM contas
UNION ALL SELECT 'categorias_sistema',  COUNT(*) FROM categorias WHERE user_id IS NULL
UNION ALL SELECT 'lancamentos',         COUNT(*) FROM lancamentos
UNION ALL SELECT 'faturas',             COUNT(*) FROM faturas
UNION ALL SELECT 'saude_biometria',     COUNT(*) FROM saude_biometria
UNION ALL SELECT 'saude_exames',        COUNT(*) FROM saude_exames
UNION ALL SELECT 'treino_ciclo_config', COUNT(*) FROM treino_ciclo_config
UNION ALL SELECT 'treino_sessoes',      COUNT(*) FROM treino_sessoes
UNION ALL SELECT 'nutricao_diario',     COUNT(*) FROM nutricao_diario;

-- Resultado esperado:
-- usuarios=0, contas=0, categorias_sistema=16,
-- demais=0 (usuários se cadastram pelo app)
