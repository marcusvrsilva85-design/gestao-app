import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import api from '../services/api';

type Conta = {
  id: string;
  nome: string;
  tipo: string;
};

type Categoria = {
  id: string;
  nome: string;
};

const fmtMoeda = (v: any) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function competenciaAtual() {
  const h = new Date();
  return `${String(h.getMonth() + 1).padStart(2, '0')}/${h.getFullYear()}`;
}

export default function RegistrarScreen() {
  const [aba, setAba] = useState<'rapido' | 'manual'>('rapido');

  // Form rápido (NLP)
  const [texto,    setTexto]   = useState('');
  const [loadNlp,  setLoadNlp] = useState(false);
  const [resultNlp,setResultNlp] = useState<any>(null);

  // Form manual
  const [contas,      setContas]      = useState<Conta[]>([]);
  const [categorias,  setCategorias]  = useState<Categoria[]>([]);
  const [descricao,   setDescricao]   = useState('');
  const [valor,       setValor]       = useState('');
  const [tipo,        setTipo]        = useState<'Saída' | 'Entrada'>('Saída');
  const [contaId,     setContaId]     = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [data,        setData]        = useState(new Date().toISOString().split('T')[0]);
  const [loadManual,  setLoadManual]  = useState(false);
  const [msgManual,   setMsgManual]   = useState({ texto: '', tipo: '' });

  useEffect(() => {
    async function carregarOpcoes() {
      try {
        const [resContas, resCats] = await Promise.allSettled([
          api.get('/api/contas'),
          api.get('/api/categorias'),
        ]);
        if (resContas.status === 'fulfilled') {
          const lista = resContas.value.data;
          setContas(lista);
          if (lista.length > 0) setContaId(lista[0].id);
        }
        if (resCats.status === 'fulfilled') {
          setCategorias(resCats.value.data);
        }
      } catch {}
    }
    carregarOpcoes();
  }, []);

  // ── REGISTRO RÁPIDO ──
  async function handleNlp() {
    if (!texto.trim()) return;
    setLoadNlp(true);
    setResultNlp(null);
    try {
      // Envia como se fosse uma mensagem do Telegram — o backend NLP processa
      const res = await api.post('/api/lancamentos', {
        data: new Date().toISOString().split('T')[0],
        descricao: texto,
        valor: extrairValor(texto),
        tipo: inferirTipo(texto),
        conta_origem_id: contas[0]?.id || contaId,
        categoria_nome: 'Outros',
        forma_pagamento: 'Pix',
        status: 'Pago',
        competencia: competenciaAtual(),
      });
      setResultNlp({ sucesso: true, dados: res.data });
      setTexto('');
      Alert.alert('✅ Registrado!', 'Lançamento salvo com sucesso.');
    } catch (err: any) {
      setResultNlp({ sucesso: false, erro: err.response?.data?.erro || 'Erro ao salvar.' });
    } finally {
      setLoadNlp(false);
    }
  }

  function extrairValor(txt: string): number {
    const match = txt.match(/R?\$?\s*([\d]+(?:[.,]\d{2})?)/);
    if (!match) return 0;
    return parseFloat(match[1].replace(',', '.'));
  }

  function inferirTipo(txt: string): 'Entrada' | 'Saída' {
    const t = txt.toLowerCase();
    if (/receb|entrou|ganhei|depositei/.test(t)) return 'Entrada';
    return 'Saída';
  }

  // ── REGISTRO MANUAL ──
  async function handleManual() {
    if (!descricao || !valor || !contaId) {
      return setMsgManual({ texto: 'Preencha descrição, valor e conta.', tipo: 'erro' });
    }
    setLoadManual(true);
    try {
      await api.post('/api/lancamentos', {
        data,
        descricao,
        valor: Number(valor.replace(',', '.')),
        tipo,
        conta_origem_id: contaId,
        categoria_id:    categoriaId || undefined,
        forma_pagamento: 'Pix',
        status:          'Pago',
        competencia:     competenciaAtual(),
      });
      setMsgManual({ texto: 'Lançamento salvo!', tipo: 'sucesso' });
      setDescricao(''); setValor(''); setCategoriaId('');
    } catch (err: any) {
      setMsgManual({ texto: err.response?.data?.erro || 'Erro ao salvar.', tipo: 'erro' });
    } finally {
      setLoadManual(false);
    }
  }

  const exemplos = [
    'paguei 50 de gasolina',
    'gastei 30 no mercado',
    'recebi 2000 do salário',
    'paguei 120 de farmácia',
  ];

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

        {/* Cabeçalho */}
        <View style={s.header}>
          <Text style={s.titulo}>Registrar</Text>
          <Text style={s.sub}>Lançamento rápido ou manual</Text>
        </View>

        {/* Abas */}
        <View style={s.abaWrap}>
          {(['rapido', 'manual'] as const).map(a => (
            <TouchableOpacity
              key={a}
              style={[s.abaBtn, aba === a && s.abaBtnAtivo]}
              onPress={() => setAba(a)}
            >
              <Text style={[s.abaTxt, aba === a && s.abaTxtAtivo]}>
                {a === 'rapido' ? '⚡ Rápido' : '✏️ Manual'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── ABA RÁPIDO ── */}
        {aba === 'rapido' && (
          <View style={s.card}>
            <Text style={s.cardTitulo}>Digite em linguagem natural</Text>
            <TextInput
              style={s.textoInput}
              placeholder="Ex: paguei 50 de gasolina débito nubank"
              value={texto}
              onChangeText={setTexto}
              multiline
              numberOfLines={3}
              placeholderTextColor="#94a3b8"
            />
            <TouchableOpacity
              style={[s.botao, (!texto.trim() || loadNlp) && s.botaoDisabled]}
              onPress={handleNlp}
              disabled={!texto.trim() || loadNlp}
            >
              {loadNlp
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.botaoTxt}>Registrar</Text>
              }
            </TouchableOpacity>

            {/* Exemplos */}
            <Text style={s.exemplosTitulo}>Exemplos:</Text>
            <View style={s.exemplosWrap}>
              {exemplos.map(ex => (
                <TouchableOpacity
                  key={ex}
                  style={s.exemploBtn}
                  onPress={() => setTexto(ex)}
                >
                  <Text style={s.exemploTxt}>{ex}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── ABA MANUAL ── */}
        {aba === 'manual' && (
          <View style={s.card}>

            {/* Tipo */}
            <Text style={s.label}>Tipo</Text>
            <View style={s.tipoWrap}>
              {(['Saída', 'Entrada'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[s.tipoBtn,
                    tipo === t && { backgroundColor: t === 'Entrada' ? '#16a34a' : '#dc2626' }
                  ]}
                  onPress={() => setTipo(t)}
                >
                  <Text style={[s.tipoTxt, tipo === t && { color: '#fff' }]}>
                    {t === 'Entrada' ? '↓ Entrada' : '↑ Saída'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Descrição */}
            <Text style={s.label}>Descrição</Text>
            <TextInput
              style={s.input}
              placeholder="Ex: Gasolina, Mercado..."
              value={descricao}
              onChangeText={setDescricao}
              placeholderTextColor="#94a3b8"
            />

            {/* Valor */}
            <Text style={s.label}>Valor (R$)</Text>
            <TextInput
              style={s.input}
              placeholder="0,00"
              value={valor}
              onChangeText={setValor}
              keyboardType="decimal-pad"
              placeholderTextColor="#94a3b8"
            />

            {/* Data */}
            <Text style={s.label}>Data</Text>
            <TextInput
              style={s.input}
              placeholder="AAAA-MM-DD"
              value={data}
              onChangeText={setData}
              placeholderTextColor="#94a3b8"
            />

            {/* Conta */}
            <Text style={s.label}>Conta</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.contasScroll}>
              {contas.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[s.contaChip, contaId === c.id && s.contaChipAtivo]}
                  onPress={() => setContaId(c.id)}
                >
                  <Text style={[s.contaChipTxt, contaId === c.id && s.contaChipTxtAtivo]}>
                    {c.nome}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Categoria */}
            <Text style={s.label}>Categoria</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.contasScroll}>
              {categorias.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[s.contaChip, categoriaId === c.id && s.contaChipAtivo]}
                  onPress={() => setCategoriaId(c.id)}
                >
                  <Text style={[s.contaChipTxt, categoriaId === c.id && s.contaChipTxtAtivo]}>
                    {c.nome}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {msgManual.texto && (
              <Text style={[s.msg, { color: msgManual.tipo === 'erro' ? '#ef4444' : '#16a34a' }]}>
                {msgManual.texto}
              </Text>
            )}

            <TouchableOpacity
              style={[s.botao, loadManual && s.botaoDisabled]}
              onPress={handleManual}
              disabled={loadManual}
            >
              {loadManual
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.botaoTxt}>Salvar lançamento</Text>
              }
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#f5f6fa' },
  content:          { padding: 20, paddingBottom: 40 },
  header:           { marginBottom: 20, paddingTop: 36 },
  titulo:           { fontSize: 22, fontWeight: '700', color: '#1A2B4A' },
  sub:              { fontSize: 13, color: '#888', marginTop: 2 },
  abaWrap:          { flexDirection: 'row', backgroundColor: '#e8eaf0', borderRadius: 12, padding: 4, marginBottom: 16 },
  abaBtn:           { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  abaBtnAtivo:      { backgroundColor: '#fff' },
  abaTxt:           { fontSize: 14, color: '#888', fontWeight: '500' },
  abaTxtAtivo:      { color: '#1A2B4A', fontWeight: '700' },
  card:             { backgroundColor: '#fff', borderRadius: 20, padding: 20 },
  cardTitulo:       { fontSize: 15, fontWeight: '700', color: '#1A2B4A', marginBottom: 12 },
  textoInput:       { borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 15, color: '#1e293b', minHeight: 80, textAlignVertical: 'top', marginBottom: 14 },
  botao:            { backgroundColor: '#1A2B4A', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 4 },
  botaoDisabled:    { backgroundColor: '#94a3b8' },
  botaoTxt:         { color: '#fff', fontSize: 16, fontWeight: '700' },
  exemplosTitulo:   { fontSize: 12, fontWeight: '600', color: '#94a3b8', marginTop: 20, marginBottom: 8, textTransform: 'uppercase' },
  exemplosWrap:     { gap: 8 },
  exemploBtn:       { backgroundColor: '#f1f5f9', borderRadius: 10, padding: 12 },
  exemploTxt:       { fontSize: 13, color: '#475569' },
  label:            { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 6, marginTop: 14, textTransform: 'uppercase' },
  input:            { borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 15, color: '#1e293b', backgroundColor: '#fafafa' },
  tipoWrap:         { flexDirection: 'row', gap: 10 },
  tipoBtn:          { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#f1f5f9', borderWidth: 0.5, borderColor: '#e2e8f0' },
  tipoTxt:          { fontSize: 14, fontWeight: '600', color: '#64748b' },
  contasScroll:     { marginBottom: 4 },
  contaChip:        { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f1f5f9', marginRight: 8, borderWidth: 0.5, borderColor: '#e2e8f0' },
  contaChipAtivo:   { backgroundColor: '#1A2B4A', borderColor: '#1A2B4A' },
  contaChipTxt:     { fontSize: 13, color: '#64748b', fontWeight: '500' },
  contaChipTxtAtivo:{ color: '#fff', fontWeight: '700' },
  msg:              { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 12 },
});