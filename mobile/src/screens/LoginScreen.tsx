import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen() {
  const { login, cadastrar } = useAuth();
  const [aba, setAba]         = useState<'login' | 'cadastro'>('login');
  const [nome, setNome]       = useState('');
  const [email, setEmail]     = useState('');
  const [senha, setSenha]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !senha) {
      Alert.alert('Atenção', 'Preencha e-mail e senha.');
      return;
    }
    if (aba === 'cadastro' && !nome) {
      Alert.alert('Atenção', 'Preencha seu nome.');
      return;
    }

    setLoading(true);
    try {
      if (aba === 'login') {
        await login(email.trim(), senha);
      } else {
        await cadastrar(nome.trim(), email.trim(), senha);
      }
    } catch (err: any) {
      const msg = err.response?.data?.erro || 'Erro ao conectar com o servidor.';
      Alert.alert('Erro', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={s.logoBox}>
          <View style={s.logoCircle}>
            <Text style={s.logoLetra}>G</Text>
          </View>
          <Text style={s.logoTitulo}>FinanceAI</Text>
          <Text style={s.logoSub}>Financeiro · Saúde · Treino</Text>
        </View>

        {/* Abas */}
        <View style={s.abaWrap}>
          <TouchableOpacity
            style={[s.abaBtn, aba === 'login' && s.abaBtnAtivo]}
            onPress={() => setAba('login')}
          >
            <Text style={[s.abaTxt, aba === 'login' && s.abaTxtAtivo]}>Entrar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.abaBtn, aba === 'cadastro' && s.abaBtnAtivo]}
            onPress={() => setAba('cadastro')}
          >
            <Text style={[s.abaTxt, aba === 'cadastro' && s.abaTxtAtivo]}>Criar conta</Text>
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View style={s.form}>
          {aba === 'cadastro' && (
            <View style={s.campo}>
              <Text style={s.label}>Nome completo</Text>
              <TextInput
                style={s.input}
                placeholder="Seu nome"
                value={nome}
                onChangeText={setNome}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={s.campo}>
            <Text style={s.label}>E-mail</Text>
            <TextInput
              style={s.input}
              placeholder="seu@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={s.campo}>
            <Text style={s.label}>Senha</Text>
            <TextInput
              style={s.input}
              placeholder="Mínimo 6 caracteres"
              value={senha}
              onChangeText={setSenha}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={[s.botao, loading && s.botaoDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.botaoTxt}>{aba === 'login' ? 'Entrar' : 'Criar conta'}</Text>
            }
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f5f6fa' },
  scroll:       { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  logoBox:      { alignItems: 'center', marginBottom: 36 },
  logoCircle:   { width: 64, height: 64, borderRadius: 18, backgroundColor: '#1A2B4A', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoLetra:    { color: '#fff', fontSize: 28, fontWeight: '700' },
  logoTitulo:   { fontSize: 22, fontWeight: '700', color: '#1A2B4A' },
  logoSub:      { fontSize: 13, color: '#888', marginTop: 4 },
  abaWrap:      { flexDirection: 'row', backgroundColor: '#e8eaf0', borderRadius: 12, padding: 4, marginBottom: 24, width: '100%' },
  abaBtn:       { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  abaBtnAtivo:  { backgroundColor: '#fff' },
  abaTxt:       { fontSize: 14, color: '#888', fontWeight: '500' },
  abaTxtAtivo:  { color: '#1A2B4A', fontWeight: '700' },
  form:         { width: '100%' },
  campo:        { marginBottom: 16 },
  label:        { fontSize: 12, fontWeight: '600', color: '#555', marginBottom: 6, textTransform: 'uppercase' },
  input:        { backgroundColor: '#fff', borderWidth: 0.5, borderColor: '#ddd', borderRadius: 12, padding: 14, fontSize: 15, color: '#1a1a2e' },
  botao:        { backgroundColor: '#1A2B4A', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  botaoDisabled:{ backgroundColor: '#94a3b8' },
  botaoTxt:     { color: '#fff', fontSize: 16, fontWeight: '700' },
});