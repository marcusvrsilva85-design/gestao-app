import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl, ActivityIndicator, TouchableOpacity, TextInput,
} from 'react-native';
import api from '../services/api';

type Lancamento = {
  id: string;
  data: string;
  descricao: string;
  valor: number | string;
  tipo: string;
  categoria_nome?: string;
  conta_origem_nome?: string;
};

const fmtMoeda = (v: any) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtData = (d: string) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

function competenciaAtual() {
  const h = new Date();
  return `${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`;
}

export default function LancamentosScreen() {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [carregando,  setCarregando]  = useState(true);
  const [refresh,     setRefresh]     = useState(false);
  const [busca,       setBusca]       = useState('');
  const [filtroTipo,  setFiltroTipo]  = useState<'Todos' | 'Entrada' | 'Saída'>('Todos');

  const carregar = useCallback(async () => {
    try {
      const comp = competenciaAtual();
      const res = await api.get(`/api/lancamentos?competencia=${comp}&limit=50`);
      setLancamentos(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setCarregando(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = lancamentos.filter(l => {
    const matchBusca = busca
      ? l.descricao.toLowerCase().includes(busca.toLowerCase())
      : true;
    const matchTipo = filtroTipo === 'Todos'
      ? true
      : l.tipo === filtroTipo;
    return matchBusca && matchTipo;
  });

  const totalEntradas = filtrados
    .filter(l => l.tipo === 'Entrada')
    .reduce((a, b) => a + Number(b.valor), 0);

  const totalSaidas = filtrados
    .filter(l => l.tipo === 'Saída')
    .reduce((a, b) => a + Number(b.valor), 0);

  if (carregando) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color="#1A2B4A" />
      </View>
    );
  }

  return (
    <View style={s.container}>

      {/* Cabeçalho */}
      <View style={s.header}>
        <Text style={s.titulo}>Extrato</Text>
        <Text style={s.sub}>{competenciaAtual()}</Text>
      </View>

      {/* Busca */}
      <View style={s.buscaWrap}>
        <TextInput
          style={s.buscaInput}
          placeholder="Buscar lançamento..."
          value={busca}
          onChangeText={setBusca}
          placeholderTextColor="#94a3b8"
        />
      </View>

      {/* Filtros */}
      <View style={s.filtros}>
        {(['Todos', 'Entrada', 'Saída'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[s.filtroBtn, filtroTipo === f && s.filtroBtnAtivo]}
            onPress={() => setFiltroTipo(f)}
          >
            <Text style={[s.filtroTxt, filtroTipo === f && s.filtroTxtAtivo]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Totais */}
      <View style={s.totaisRow}>
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Entradas</Text>
          <Text style={[s.totalValor, { color: '#22c55e' }]}>{fmtMoeda(totalEntradas)}</Text>
        </View>
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>Saídas</Text>
          <Text style={[s.totalValor, { color: '#ef4444' }]}>{fmtMoeda(totalSaidas)}</Text>
        </View>
      </View>

      {/* Lista */}
      <ScrollView
        style={s.lista}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); carregar(); }} />
        }
      >
        {filtrados.length === 0 ? (
          <View style={s.vazioWrap}>
            <Text style={s.vazioTxt}>Nenhum lançamento encontrado.</Text>
          </View>
        ) : (
          filtrados.map(l => (
            <View key={l.id} style={s.item}>
              <View style={[
                s.itemIcone,
                { backgroundColor: l.tipo === 'Entrada' ? '#dcfce7' : l.tipo === 'Saída' ? '#fee2e2' : '#e0e7ff' }
              ]}>
                <Text style={s.itemIconeTxt}>
                  {l.tipo === 'Entrada' ? '↓' : l.tipo === 'Saída' ? '↑' : '⇄'}
                </Text>
              </View>
              <View style={s.itemInfo}>
                <Text style={s.itemDesc} numberOfLines={1}>{l.descricao}</Text>
                <Text style={s.itemMeta}>
                  {fmtData(l.data)}
                  {l.categoria_nome ? ` · ${l.categoria_nome}` : ''}
                  {l.conta_origem_nome ? ` · ${l.conta_origem_nome}` : ''}
                </Text>
              </View>
              <Text style={[
                s.itemValor,
                { color: l.tipo === 'Entrada' ? '#16a34a' : l.tipo === 'Saída' ? '#1e293b' : '#6366f1' }
              ]}>
                {l.tipo === 'Saída' ? '-' : '+'}{fmtMoeda(l.valor)}
              </Text>
            </View>
          ))
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  loading:       { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' },
  container:     { flex: 1, backgroundColor: '#f5f6fa' },
  header:        { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16, backgroundColor: '#f5f6fa' },
  titulo:        { fontSize: 22, fontWeight: '700', color: '#1A2B4A' },
  sub:           { fontSize: 13, color: '#888', marginTop: 2 },
  buscaWrap:     { paddingHorizontal: 20, marginBottom: 10 },
  buscaInput:    { backgroundColor: '#fff', borderRadius: 12, padding: 12, fontSize: 14, color: '#1e293b', borderWidth: 0.5, borderColor: '#e2e8f0' },
  filtros:       { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  filtroBtn:     { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#e2e8f0' },
  filtroBtnAtivo:{ backgroundColor: '#1A2B4A', borderColor: '#1A2B4A' },
  filtroTxt:     { fontSize: 13, color: '#64748b', fontWeight: '500' },
  filtroTxtAtivo:{ color: '#fff', fontWeight: '700' },
  totaisRow:     { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 12 },
  totalCard:     { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14 },
  totalLabel:    { fontSize: 11, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' },
  totalValor:    { fontSize: 16, fontWeight: '800', marginTop: 4 },
  lista:         { flex: 1, paddingHorizontal: 20 },
  vazioWrap:     { alignItems: 'center', paddingTop: 48 },
  vazioTxt:      { color: '#94a3b8', fontStyle: 'italic' },
  item:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, gap: 12 },
  itemIcone:     { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  itemIconeTxt:  { fontSize: 16, fontWeight: '700', color: '#475569' },
  itemInfo:      { flex: 1 },
  itemDesc:      { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  itemMeta:      { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  itemValor:     { fontSize: 14, fontWeight: '700' },
});