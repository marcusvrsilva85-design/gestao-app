import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';

type Usuario = {
  id: string;
  nome: string;
  email: string;
  plano: string;
  telegram_ativo?: boolean;
};

type AuthContextType = {
  usuario: Usuario | null;
  token: string | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [token, setToken]     = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function carregar() {
      try {
        const t = await SecureStore.getItemAsync('token');
        const u = await SecureStore.getItemAsync('usuario');
        if (t && u) {
          setToken(t);
          setUsuario(JSON.parse(u));
        }
      } finally {
        setCarregando(false);
      }
    }
    carregar();
  }, []);

  async function login(email: string, senha: string) {
    const { data } = await api.post('/auth/login', { email, senha });
    await SecureStore.setItemAsync('token', data.token);
    await SecureStore.setItemAsync('usuario', JSON.stringify(data.usuario));
    setToken(data.token);
    setUsuario(data.usuario);
  }

  async function cadastrar(nome: string, email: string, senha: string) {
    const { data } = await api.post('/auth/register', { nome, email, senha });
    await SecureStore.setItemAsync('token', data.token);
    await SecureStore.setItemAsync('usuario', JSON.stringify(data.usuario));
    setToken(data.token);
    setUsuario(data.usuario);
  }

  async function logout() {
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('usuario');
    setToken(null);
    setUsuario(null);
  }

  return (
    <AuthContext.Provider value={{ usuario, token, carregando, login, cadastrar, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);