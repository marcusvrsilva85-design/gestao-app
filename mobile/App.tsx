import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text } from 'react-native';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';

import LoginScreen       from './src/screens/LoginScreen';
import HomeScreen        from './src/screens/HomeScreen';
import LancamentosScreen from './src/screens/LancamentosScreen';
import RegistrarScreen   from './src/screens/RegistrarScreen';
import SaudeScreen       from './src/screens/SaudeScreen';
import PerfilScreen      from './src/screens/PerfilScreen';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1A2B4A',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Início', tabBarIcon: () => <Text>🏠</Text> }}
      />
      <Tab.Screen
        name="Lancamentos"
        component={LancamentosScreen}
        options={{ tabBarLabel: 'Extrato', tabBarIcon: () => <Text>📋</Text> }}
      />
      <Tab.Screen
        name="Registrar"
        component={RegistrarScreen}
        options={{ tabBarLabel: 'Registrar', tabBarIcon: () => <Text>➕</Text> }}
      />
      <Tab.Screen
        name="Saude"
        component={SaudeScreen}
        options={{ tabBarLabel: 'Saúde', tabBarIcon: () => <Text>❤️</Text> }}
      />
      <Tab.Screen
        name="Perfil"
        component={PerfilScreen}
        options={{ tabBarLabel: 'Perfil', tabBarIcon: () => <Text>👤</Text> }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa' }}>
        <ActivityIndicator size="large" color="#1A2B4A" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {usuario ? (
        <Stack.Screen name="Main" component={TabNavigator} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}