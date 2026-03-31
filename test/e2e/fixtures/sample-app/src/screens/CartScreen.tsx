import React from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';

export default function CartScreen({ navigation }: any) {
  const cartItems = [
    { id: '1', name: 'Wireless Headphones', price: 79.99, quantity: 1 },
    { id: '2', name: 'Phone Case', price: 19.99, quantity: 2 },
  ];

  const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <View accessibilityLabel="cart-screen">
      <Text>Shopping Cart</Text>
      <FlatList
        data={cartItems}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View accessibilityLabel={`cart-item-${item.id}`}>
            <Text>{item.name}</Text>
            <Text>${item.price} x {item.quantity}</Text>
            <TouchableOpacity accessibilityLabel={`remove-${item.id}`}>
              <Text>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      />
      <Text accessibilityLabel="cart-total">Total: ${total.toFixed(2)}</Text>
      <TouchableOpacity accessibilityLabel="checkout-button" onPress={() => navigation.navigate('Checkout')}>
        <Text>Proceed to Checkout</Text>
      </TouchableOpacity>
    </View>
  );
}
