import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, TextInput, Alert,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

export default function PerfilScreen() {
  const { usuario, logout } = useAuth();

  const [chatId,     setChatId]     = useState('');
  const [loadTel,    setLoadTel]    = useState(false);
  const [msgTel,     setMsgTel]     = useState({ texto: '', tipo: '' });

  const [senhaAtual, setSenhaAtual] = useState('');
  const [senhaNova,  setSenhaNova]  = useState('');
  const [loadSenha,  setLoadSenha]  = useState(false);
  const [msgSenha,   setMsgSenha]   = useState({ texto: '', tipo: '' });

  async function conectarTelegram() {
    if (!chatId.trim())
      return setMsgTel({ texto: 'Informe o Chat ID.', tipo: 'erro' });

    setLoadTel(true);
    try {
      await api.patch('/auth/telegram', { chat_id: chatId.trim() });
      setMsgTel({ texto: 'Telegram conectado!', tipo: 'sucesso' });
      setChatId('');
    } catch (err: any) {
      setMsgTel({ texto: err.response?.data?.erro || 'Erro ao conectar.', tipo: 'erro' });
    } finally {
      setLoadTel(false);
    }
  }

  async function alterarSenha() {
    if (!senhaAtual || !senhaNova)
      return setMsgSenha({ texto: 'Preencha os dois campos.', tipo: 'erro' });
    if (senhaNova.length < 6)
      return setMsgSenha({ texto: 'Nova senha deve ter mínimo 6 caracteres.', tipo: 'erro' });

    setLoadSenha(true);
    try {
      await api.patch('/auth/senha', { senha_atual: senhaAtual, senha_nova: senhaNova });
      setMsgSenha({ texto: 'Senha alterada com sucesso!', tipo: 'sucesso' });
      setSenhaAtual(''); setSenhaNova('');
    } catch (err: any) {
      setMsgSenha({ texto: err.response?.data?.erro || 'Erro ao alterar senha.', tipo: 'erro' });
    } finally {
      setLoadSenha(false);
    }
  }

  function confirmarLogout() {
    Alert.alert(
      'Sair da conta',
      'Tem certeza que deseja sair?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Sair', style: 'destructive', onPress: logout },
      ]
    );
  }

  const iniciais = usuario?.nome
    ?.split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase() || 'U';

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      {/* Avatar e dados */}
      <View style={s.perfilCard}>
        <View style={s.avatar}>
          <Text style={s.avatarTxt}>{iniciais}</Text>
        </View>
        <Text style={s.nome}>{usuario?.nome}</Text>
        <Text style={s.email}>{usuario?.email}</Text>
        <View style={s.planoBadge}>
          <Text style={s.planoTxt}>
            {usuario?.plano === 'pro' ? '⭐ Plano Pro' : '🆓 Plano Free'}
          </Text>
        </View>
      </View>

      {/* Status Telegram */}
      <View style={[s.telCard, { backgroundColor: usuario?.telegram_ativo ? '#1A2B4A' : '#f59e0b' }]}>
        <View style={s.telRow}>
          <Text style={s.telIcone}>🤖</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.telTitulo}>Bot do Telegram</Text>
            <Text style={s.telStatus}>
              {usuario?.telegram_ativo ? 'Conectado e funcionando' : 'Não conectado'}
            </Text>
          </View>
        </View>
      </View>

      {/* Conectar Telegram */}
      {!usuario?.telegram_ativo && (
        <View style={s.card}>
          <Text style={s.cardTitulo}>Conectar Telegram</Text>
          <Text style={s.cardSub}>
            1. Abra o Telegram{'\n'}
            2. Envie uma mensagem para @userinfobot{'\n'}
            3. Copie o número ID que ele responder{'\n'}
            4. Cole abaixo e clique em conectar
          </Text>
          <TextInput
            style={s.input}
            placeholder="Seu Chat ID (ex: 123456789)"
            value={chatId}
            onChangeText={setChatId}
            keyboardType="number-pad"
            placeholderTextColor="#94a3b8"
          />
          {msgTel.texto && (
            <Text style={[s.msg, { color: msgTel.tipo === 'erro' ? '#ef4444' : '#16a34a' }]}>
              {msgTel.texto}
            </Text>
          )}
          <TouchableOpacity
            style={[s.botao, loadTel && s.botaoDisabled]}
            onPress={conectarTelegram}
            disabled={loadTel}
          >
            {loadTel
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.botaoTxt}>Conectar bot</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* Comandos do Telegram */}
      <View style={s.card}>
        <Text style={s.cardTitulo}>Comandos do bot</Text>
        {[
          { cmd: 'paguei 50 de gasolina', desc: 'Registrar saída' },
          { cmd: 'recebi 2000 do salário', desc: 'Registrar entrada' },
          { cmd: 'transferi 500 da caixa para o nubank', desc: 'Transferência' },
          { cmd: '/saldo', desc: 'Ver saldos' },
          { cmd: '/mes', desc: 'Resumo do mês' },
          { cmd: '/faturas', desc: 'Faturas pendentes' },
        ].map(({ cmd, desc }) => (
          <View key={cmd} style={s.cmdRow}>
            <Text style={s.cmdTxt}>{cmd}</Text>
            <Text style={s.cmdDesc}>{desc}</Text>
          </View>
        ))}
      </View>

      {/* Alterar senha */}
      <View style={s.card}>
        <Text style={s.cardTitulo}>Alterar senha</Text>
        <TextInput
          style={[s.input, { marginBottom: 10 }]}
          placeholder="Senha atual"
          value={senhaAtual}
          onChangeText={setSenhaAtual}
          secureTextEntry
          placeholderTextColor="#94a3b8"
        />
        <TextInput
          style={s.input}
          placeholder="Nova senha (mín. 6 caracteres)"
          value={senhaNova}
          onChangeText={setSenhaNova}
          secureTextEntry
          placeholderTextColor="#94a3b8"
        />
        {msgSenha.texto && (
          <Text style={[s.msg, { color: msgSenha.tipo === 'erro' ? '#ef4444' : '#16a34a' }]}>
            {msgSenha.texto}
          </Text>
        )}
        <TouchableOpacity
          style={[s.botao, { backgroundColor: '#475569' }, loadSenha && s.botaoDisabled]}
          onPress={alterarSenha}
          disabled={loadSenha}
        >
          {loadSenha
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.botaoTxt}>Alterar senha</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Sair */}
      <TouchableOpacity style={s.sairBtn} onPress={confirmarLogout}>
        <Text style={s.sairTxt}>Sair da conta</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f5f6fa' },
  content:      { padding: 20, paddingTop: 56, paddingBottom: 40 },
  perfilCard:   { backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 16 },
  avatar:       { width: 72, height: 72, borderRadius: 36, backgroundColor: '#1A2B4A', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarTxt:    { color: '#fff', fontSize: 26, fontWeight: '800' },
  nome:         { fontSize: 20, fontWeight: '700', color: '#1A2B4A' },
  email:        { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  planoBadge:   { marginTop: 12, backgroundColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  planoTxt:     { fontSize: 13, fontWeight: '600', color: '#475569' },
  telCard:      { borderRadius: 16, padding: 16, marginBottom: 16 },
  telRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  telIcone:     { fontSize: 28 },
  telTitulo:    { fontSize: 15, fontWeight: '700', color: '#fff' },
  telStatus:    { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  card:         { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 16 },
  cardTitulo:   { fontSize: 16, fontWeight: '700', color: '#1A2B4A', marginBottom: 8 },
  cardSub:      { fontSize: 13, color: '#64748b', lineHeight: 20, marginBottom: 14 },
  input:        { borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 14, fontSize: 15, color: '#1e293b', backgroundColor: '#fafafa' },
  msg:          { fontSize: 13, fontWeight: '600', marginTop: 8 },
  botao:        { backgroundColor: '#1A2B4A', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  botaoDisabled:{ backgroundColor: '#94a3b8' },
  botaoTxt:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  cmdRow:       { paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#f1f5f9' },
  cmdTxt:       { fontSize: 13, fontWeight: '600', color: '#1e293b', fontFamily: 'monospace' },
  cmdDesc:      { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  sairBtn:      { backgroundColor: '#fee2e2', borderRadius: 14, padding: 16, alignItems: 'center' },
  sairTxt:      { color: '#dc2626', fontSize: 16, fontWeight: '700' },
});