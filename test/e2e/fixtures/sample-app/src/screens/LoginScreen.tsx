import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    const res = await fetch('https://api.example.com/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) navigation.navigate('Home');
    else Alert.alert('Error', 'Invalid credentials');
  };

  return (
    <View accessibilityLabel="login-screen">
      <Text>Welcome Back</Text>
      <TextInput accessibilityLabel="email-input" placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput accessibilityLabel="password-input" placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity accessibilityLabel="login-button" onPress={handleLogin}>
        <Text>Login</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityLabel="forgot-password" onPress={() => navigation.navigate('ForgotPassword')}>
        <Text>Forgot Password?</Text>
      </TouchableOpacity>
    </View>
  );
}
