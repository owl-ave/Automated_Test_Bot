import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image } from 'react-native';

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
}

export default function HomeScreen({ navigation }: any) {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    fetch('https://api.example.com/products')
      .then(res => res.json())
      .then(setProducts);
  }, []);

  return (
    <View accessibilityLabel="home-screen">
      <Text>Featured Products</Text>
      <FlatList
        data={products}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            accessibilityLabel={`product-${item.id}`}
            onPress={() => navigation.navigate('ProductDetail', { id: item.id })}
          >
            <Image source={{ uri: item.image }} accessibilityLabel={`image-${item.name}`} />
            <Text>{item.name}</Text>
            <Text>${item.price}</Text>
            <TouchableOpacity accessibilityLabel={`add-to-cart-${item.id}`}>
              <Text>Add to Cart</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
