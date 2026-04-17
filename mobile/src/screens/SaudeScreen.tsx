import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  RefreshControl, ActivityIndicator, TouchableOpacity,
  TextInput, Alert,
} from 'react-native';
import api from '../services/api';

type Biometria = {
  id: string;
  data_medicao: string;
  peso_kg?: number | string;
  gordura_pct?: number | string;
  musculo_kg?: number | string;
  agua_pct?: number | string;
  imc?: number | string;
  tmb_kcal?: number | string;
  fonte?: string;
};

type Exame = {
  id: string;
  data_exame: string;
  nome: string;
  resultado: string;
  unidade?: string;
  status_alerta: string;
  laboratorio?: string;
};

const fmt1 = (v: any) => v != null ? Number(v).toFixed(1) : '—';
const fmtD = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';

const corAlerta = (s: string) =>
  s === 'critico' ? '#ef4444' : s === 'atencao' ? '#f59e0b' : '#22c55e';

const labelAlerta = (s: string) =>
  s === 'critico' ? 'Crítico' : s === 'atencao' ? 'Atenção' : 'Normal';

export default function SaudeScreen() {
  const [aba, setAba]           = useState<'bio' | 'exames'>('bio');
  const [carregando, setCarregando] = useState(true);
  const [refresh,   setRefresh]  = useState(false);
  const [historico, setHistorico]= useState<Biometria[]>([]);
  const [exames,    setExames]   = useState<Exame[]>([]);
  const [mostraForm, setMostraForm] = useState(false);

  // Form biometria
  const [fData,  setFData]  = useState(new Date().toISOString().split('T')[0]);
  const [fPeso,  setFPeso]  = useState('');
  const [fGord,  setFGord]  = useState('');
  const [fMusc,  setFMusc]  = useState('');
  const [fAgua,  setFAgua]  = useState('');
  const [fAltura,setFAltura]= useState('');
  const [loading, setLoading]= useState(false);

  const carregar = useCallback(async () => {
    try {
      const [resBio, resEx] = await Promise.allSettled([
        api.get('/api/saude/biometria?limit=10'),
        api.get('/api/saude/exames'),
      ]);
      if (resBio.status === 'fulfilled')
        setHistorico(Array.isArray(resBio.value.data) ? resBio.value.data : []);
      if (resEx.status === 'fulfilled')
        setExames(Array.isArray(resEx.value.data) ? resEx.value.data : []);
    } finally {
      setCarregando(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvarBiometria() {
    if (!fData) return Alert.alert('Atenção', 'Informe a data.');
    setLoading(true);
    try {
      await api.post('/api/saude/biometria', {
        data_medicao:  fData,
        peso_kg:       fPeso   ? Number(fPeso)   : undefined,
        altura_cm:     fAltura ? Number(fAltura) : undefined,
        gordura_pct:   fGord   ? Number(fGord)   : undefined,
        musculo_kg:    fMusc   ? Number(fMusc)   : undefined,
        agua_pct:      fAgua   ? Number(fAgua)   : undefined,
        fonte: 'App',
      });
      Alert.alert('✅ Salvo!', 'Medição registrada com sucesso.');
      setFPeso(''); setFGord(''); setFMusc(''); setFAgua(''); setFAltura('');
      setMostraForm(false);
      carregar();
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar.');
    } finally {
      setLoading(false);
    }
  }

  const atual    = historico[0] ?? null;
  const anterior = historico[1] ?? null;

  function Delta({ a, b, u = '' }: { a: any; b: any; u?: string }) {
    if (!a || !b) return null;
    const diff = Number(a) - Number(b);
    if (Math.abs(diff) < 0.01) return null;
    const positivo = diff > 0;
    return (
      <Text style={{ fontSize: 11, color: positivo ? '#ef4444' : '#22c55e', fontWeight: '600' }}>
        {positivo ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}{u}
      </Text>
    );
  }

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
        <View>
          <Text style={s.titulo}>Saúde</Text>
          <Text style={s.sub}>Composição corporal e exames</Text>
        </View>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setMostraForm(!mostraForm)}
        >
          <Text style={s.addBtnTxt}>{mostraForm ? '✕ Fechar' : '+ Medição'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refresh} onRefresh={() => { setRefresh(true); carregar(); }} />
        }
      >
        {/* Form inline */}
        {mostraForm && (
          <View style={s.formCard}>
            <Text style={s.formTitulo}>Nova medição</Text>
            {[
              { label: 'Data',         val: fData,   set: setFData,   keyboard: 'default' as const },
              { label: 'Peso (kg)',     val: fPeso,   set: setFPeso,   keyboard: 'decimal-pad' as const },
              { label: 'Altura (cm)',   val: fAltura, set: setFAltura, keyboard: 'decimal-pad' as const },
              { label: 'Gordura (%)',   val: fGord,   set: setFGord,   keyboard: 'decimal-pad' as const },
              { label: 'Músculo (kg)', val: fMusc,   set: setFMusc,   keyboard: 'decimal-pad' as const },
              { label: 'Água (%)',      val: fAgua,   set: setFAgua,   keyboard: 'decimal-pad' as const },
            ].map(({ label, val, set, keyboard }) => (
              <View key={label} style={s.formCampo}>
                <Text style={s.formLabel}>{label}</Text>
                <TextInput
                  style={s.formInput}
                  value={val}
                  onChangeText={set}
                  keyboardType={keyboard}
                  placeholder="—"
                  placeholderTextColor="#94a3b8"
                />
              </View>
            ))}
            <TouchableOpacity
              style={[s.botao, loading && s.botaoDisabled]}
              onPress={salvarBiometria}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.botaoTxt}>Salvar medição</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* KPIs última medição */}
        {atual && (
          <>
            <Text style={s.secTitulo}>Última medição — {fmtD(atual.data_medicao)}</Text>
            <View style={s.kpiGrid}>
              {[
                { label: 'Peso',    val: fmt1(atual.peso_kg),     u: 'kg', da: atual.peso_kg,    db: anterior?.peso_kg,    du: 'kg' },
                { label: 'Gordura', val: fmt1(atual.gordura_pct), u: '%',  da: atual.gordura_pct, db: anterior?.gordura_pct,du: '%' },
                { label: 'Músculo', val: fmt1(atual.musculo_kg),  u: 'kg', da: atual.musculo_kg,  db: anterior?.musculo_kg, du: 'kg' },
                { label: 'IMC',     val: fmt1(atual.imc),         u: '',   da: atual.imc,         db: anterior?.imc,        du: '' },
              ].map(({ label, val, u, da, db, du }) => (
                <View key={label} style={s.kpiCard}>
                  <Text style={s.kpiLabel}>{label}</Text>
                  <Text style={s.kpiValor}>{val}<Text style={s.kpiUnidade}> {u}</Text></Text>
                  <Delta a={da} b={db} u={du} />
                </View>
              ))}
            </View>
          </>
        )}

        {/* Abas */}
        <View style={s.abaWrap}>
          {(['bio', 'exames'] as const).map(a => (
            <TouchableOpacity
              key={a}
              style={[s.abaBtn, aba === a && s.abaBtnAtivo]}
              onPress={() => setAba(a)}
            >
              <Text style={[s.abaTxt, aba === a && s.abaTxtAtivo]}>
                {a === 'bio' ? 'Histórico' : 'Exames'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Histórico biometria */}
        {aba === 'bio' && (
          <View style={s.card}>
            {historico.length === 0 ? (
              <Text style={s.vazio}>Nenhuma medição registrada.</Text>
            ) : (
              historico.map((b, i) => (
                <View key={b.id} style={[s.bioRow, i === historico.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={s.bioData}>{fmtD(b.data_medicao)}</Text>
                  <View style={s.bioVals}>
                    {b.peso_kg    && <Text style={s.bioVal}>{fmt1(b.peso_kg)}kg</Text>}
                    {b.gordura_pct && <Text style={[s.bioVal, { color: '#ef4444' }]}>{fmt1(b.gordura_pct)}%G</Text>}
                    {b.musculo_kg && <Text style={[s.bioVal, { color: '#3b82f6' }]}>{fmt1(b.musculo_kg)}kg M</Text>}
                    {b.imc        && <Text style={s.bioVal}>IMC {fmt1(b.imc)}</Text>}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Exames */}
        {aba === 'exames' && (
          <View style={s.card}>
            {exames.length === 0 ? (
              <Text style={s.vazio}>Nenhum exame registrado.</Text>
            ) : (
              exames.map((ex, i) => (
                <View key={ex.id} style={[s.exameRow, i === exames.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.exameNome}>{ex.nome}</Text>
                    <Text style={s.exameMeta}>
                      {fmtD(ex.data_exame)}
                      {ex.laboratorio ? ` · ${ex.laboratorio}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.exameRes}>{ex.resultado}</Text>
                    <View style={[s.alertaBadge, { backgroundColor: corAlerta(ex.status_alerta) + '20' }]}>
                      <Text style={[s.alertaTxt, { color: corAlerta(ex.status_alerta) }]}>
                        {labelAlerta(ex.status_alerta)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  loading:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' },
  container:    { flex: 1, backgroundColor: '#f5f6fa' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16 },
  titulo:       { fontSize: 22, fontWeight: '700', color: '#1A2B4A' },
  sub:          { fontSize: 13, color: '#888', marginTop: 2 },
  addBtn:       { backgroundColor: '#1A2B4A', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnTxt:    { color: '#fff', fontSize: 13, fontWeight: '700' },
  scroll:       { flex: 1, paddingHorizontal: 20 },
  formCard:     { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 16 },
  formTitulo:   { fontSize: 15, fontWeight: '700', color: '#1A2B4A', marginBottom: 12 },
  formCampo:    { marginBottom: 10 },
  formLabel:    { fontSize: 11, fontWeight: '600', color: '#64748b', marginBottom: 4, textTransform: 'uppercase' },
  formInput:    { borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, fontSize: 15, color: '#1e293b', backgroundColor: '#fafafa' },
  botao:        { backgroundColor: '#1A2B4A', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  botaoDisabled:{ backgroundColor: '#94a3b8' },
  botaoTxt:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  secTitulo:    { fontSize: 15, fontWeight: '700', color: '#1A2B4A', marginBottom: 10, marginTop: 4 },
  kpiGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  kpiCard:      { width: '47%', backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  kpiLabel:     { fontSize: 11, color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' },
  kpiValor:     { fontSize: 24, fontWeight: '800', color: '#1A2B4A', marginTop: 4 },
  kpiUnidade:   { fontSize: 14, fontWeight: '400', color: '#94a3b8' },
  abaWrap:      { flexDirection: 'row', backgroundColor: '#e8eaf0', borderRadius: 12, padding: 4, marginBottom: 12 },
  abaBtn:       { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  abaBtnAtivo:  { backgroundColor: '#fff' },
  abaTxt:       { fontSize: 14, color: '#888', fontWeight: '500' },
  abaTxtAtivo:  { color: '#1A2B4A', fontWeight: '700' },
  card:         { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16 },
  vazio:        { color: '#94a3b8', textAlign: 'center', fontStyle: 'italic', paddingVertical: 8 },
  bioRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  bioData:      { fontSize: 13, fontWeight: '600', color: '#475569', width: 90 },
  bioVals:      { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bioVal:       { fontSize: 12, backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, color: '#334155', fontWeight: '600' },
  exameRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  exameNome:    { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  exameMeta:    { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  exameRes:     { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  alertaBadge:  { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  alertaTxt:    { fontSize: 10, fontWeight: '700' },
});