import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

type Saldo = {
  id: string;
  nome: string;
  tipo: string;
  saldo_atual: number | string;
  cor_hex?: string;
};

type Fatura = {
  id: string;
  conta_nome: string;
  valor_total: number | string;
  vencimento: string;
  alerta: string;
  dias_ate_vencimento: number;
};

type Resumo = {
  total_entradas: number | string;
  total_saidas: number | string;
  qtd_lancamentos: number | string;
};

const fmtMoeda = (v: any) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtData = (d: string) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

function competenciaAtual() {
  const h = new Date();
  return `${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`;
}

export default function HomeScreen() {
  const { usuario } = useAuth();

  const [saldos,    setSaldos]    = useState<Saldo[]>([]);
  const [faturas,   setFaturas]   = useState<Fatura[]>([]);
  const [resumo,    setResumo]    = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [refresh,   setRefresh]   = useState(false);

  const carregar = useCallback(async () => {
  try {
    const comp = competenciaAtual();
    
    const [resSaldos, resFaturas, resResumo] = await Promise.allSettled([
      api.get('/api/saldos'),
      api.get('/api/faturas'),
      api.get(`/api/resumo?competencia=${comp}`),
    ]);

    if (resSaldos.status === 'fulfilled')
      setSaldos(resSaldos.value.data);

    if (resFaturas.status === 'fulfilled')
      setFaturas(resFaturas.value.data);

    if (resResumo.status === 'fulfilled')
      setResumo(resResumo.value.data.resumo);

  } catch (err) {
    console.error(err);
  } finally {
    setCarregando(false);
    setRefresh(false);
  }
}, []);

  useEffect(() => { carregar(); }, [carregar]);

  const totalSaldo = saldos
    .filter(s => s.tipo !== 'Milhas' && s.tipo !== 'Milhas/Pontos')
    .reduce((a, b) => a + Number(b.saldo_atual), 0);

  const corAlerta = (alerta: string) => ({
    atrasada: '#ef4444',
    urgente:  '#f59e0b',
    proxima:  '#eab308',
    ok:       '#22c55e',
  }[alerta] || '#94a3b8');

  if (carregando) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color="#1A2B4A" />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); carregar(); }} />}
    >
      {/* Cabeçalho */}
      <View style={s.header}>
        <View>
          <Text style={s.ola}>Olá, {usuario?.nome?.split(' ')[0]} 👋</Text>
          <Text style={s.sub}>{competenciaAtual()}</Text>
        </View>
        <View style={[s.telBadge, { backgroundColor: usuario?.telegram_ativo ? '#1A2B4A' : '#f59e0b' }]}>
          <Text style={s.telTxt}>{usuario?.telegram_ativo ? '🤖 ON' : '🤖 OFF'}</Text>
        </View>
      </View>

      {/* Card saldo total */}
      <View style={s.cardSaldoTotal}>
        <Text style={s.cardSaldoLabel}>Saldo líquido total</Text>
        <Text style={[s.cardSaldoValor, { color: totalSaldo < 0 ? '#ef4444' : '#fff' }]}>
          {fmtMoeda(totalSaldo)}
        </Text>
        <View style={s.cardSaldoRow}>
          <View>
            <Text style={s.cardSaldoSubLabel}>Entradas</Text>
            <Text style={s.cardSaldoEntrada}>{fmtMoeda(resumo?.total_entradas)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.cardSaldoSubLabel}>Saídas</Text>
            <Text style={s.cardSaldoSaida}>{fmtMoeda(resumo?.total_saidas)}</Text>
          </View>
        </View>
      </View>

      {/* Saldos por conta */}
      <Text style={s.secTitulo}>Contas</Text>
      <View style={s.card}>
        {saldos.length === 0 ? (
          <Text style={s.vazio}>Nenhuma conta cadastrada.</Text>
        ) : (
          saldos.map((s2, i) => (
            <View key={s2.id} style={[s.contaRow, i === saldos.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[s.contaDot, { backgroundColor: `#${s2.cor_hex || '1A2B4A'}` }]} />
              <Text style={s.contaNome}>{s2.nome}</Text>
              <Text style={[s.contaValor, { color: Number(s2.saldo_atual) < 0 ? '#ef4444' : '#1A2B4A' }]}>
                {fmtMoeda(s2.saldo_atual)}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Faturas */}
      {faturas.length > 0 && (
        <>
          <Text style={s.secTitulo}>Faturas pendentes</Text>
          {faturas.map(f => (
            <View key={f.id} style={[s.faturaCard, { borderLeftColor: corAlerta(f.alerta) }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.faturaNome}>{f.conta_nome}</Text>
                <Text style={s.faturaData}>
                  Vence: {fmtData(f.vencimento)}
                  {f.dias_ate_vencimento < 0
                    ? ` · ${Math.abs(f.dias_ate_vencimento)}d em atraso`
                    : f.dias_ate_vencimento === 0
                    ? ' · Vence hoje'
                    : ` · ${f.dias_ate_vencimento}d restantes`}
                </Text>
              </View>
              <Text style={[s.faturaValor, { color: corAlerta(f.alerta) }]}>
                {fmtMoeda(f.valor_total)}
              </Text>
            </View>
          ))}
        </>
      )}

      {/* Transações do mês */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Transações</Text>
          <Text style={s.statValor}>{resumo?.qtd_lancamentos || 0}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Faturas</Text>
          <Text style={s.statValor}>{faturas.length}</Text>
        </View>
      </View>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' },
  container:         { flex: 1, backgroundColor: '#f5f6fa' },
  content:           { padding: 20, paddingBottom: 40 },
  header:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  ola:               { fontSize: 22, fontWeight: '700', color: '#1A2B4A' },
  sub:               { fontSize: 13, color: '#888', marginTop: 2 },
  telBadge:          { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  telTxt:            { color: '#fff', fontSize: 12, fontWeight: '700' },
  cardSaldoTotal:    { backgroundColor: '#1A2B4A', borderRadius: 20, padding: 24, marginBottom: 24 },
  cardSaldoLabel:    { color: '#94a3b8', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  cardSaldoValor:    { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 4, marginBottom: 20 },
  cardSaldoRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  cardSaldoSubLabel: { color: '#94a3b8', fontSize: 11, marginBottom: 2 },
  cardSaldoEntrada:  { color: '#4ade80', fontSize: 16, fontWeight: '700' },
  cardSaldoSaida:    { color: '#f87171', fontSize: 16, fontWeight: '700' },
  secTitulo:         { fontSize: 16, fontWeight: '700', color: '#1A2B4A', marginBottom: 10 },
  card:              { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 20 },
  vazio:             { color: '#94a3b8', textAlign: 'center', fontStyle: 'italic', paddingVertical: 8 },
  contaRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  contaDot:          { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  contaNome:         { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  contaValor:        { fontSize: 14, fontWeight: '700' },
  faturaCard:        { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 4 },
  faturaNome:        { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  faturaData:        { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  faturaValor:       { fontSize: 16, fontWeight: '800', marginLeft: 12 },
  statsRow:          { flexDirection: 'row', gap: 12, marginTop: 4 },
  statCard:          { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16, alignItems: 'center' },
  statLabel:         { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  statValor:         { fontSize: 28, fontWeight: '800', color: '#1A2B4A', marginTop: 4 },
});