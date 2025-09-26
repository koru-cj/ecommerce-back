-- Active: 1752232418147@@turntable.proxy.rlwy.net@20123@railway
-- Usuario administrador
INSERT INTO users (name, email, password, role)
VALUES ('Admin Local', 'admin@mitienda.com', '$2b$10$1gf1UfnWYxQ.EqkU9G2fJOCnY1iAf60z8xsbXe8eWziPMa9FzGHCe', 'admin');

-- Categorías
INSERT INTO categories (name) VALUES 
  ('Tecnología'),
  ('Hogar'),
  ('Jardín');

-- Productos
INSERT INTO products (name, description, image_url, price, stock, category_id)
VALUES 
  ('Auriculares Bluetooth', 'Cancelación de ruido y carga rápida.', 'https://via.placeholder.com/150', 15999.99, 20, 1),
  ('Teclado Mecánico RGB', 'Retroiluminado con switches blue', 'https://via.placeholder.com/150', 22999.00, 15, 1),
  ('Cafetera Express', 'Cafetera compacta con vaporizador', 'https://via.placeholder.com/150', 47999.50, 10, 2),
  ('Lámpara de Escritorio LED', '3 intensidades y puerto USB', 'https://via.placeholder.com/150', 7999.90, 25, 2),
  ('Set de Macetas', 'Macetas cerámicas decorativas', 'https://via.placeholder.com/150', 3499.00, 30, 3);

-- Carrito (asociado al admin solo como ejemplo)
INSERT INTO cart_items (user_id, product_id, quantity) VALUES 
  (1, 1, 2),
  (1, 4, 1);

-- Wishlist
INSERT INTO wishlist_items (user_id, product_id) VALUES 
  (1, 2),
  (1, 5);

-- Pedido simulado
INSERT INTO orders (user_id, status) VALUES 
  (1, 'completed');

-- Ítems del pedido (productos comprados)
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES 
  (1, 1, 2, 15999.99),
  (1, 4, 1, 7999.90);

-- Pago asociado
INSERT INTO payments (order_id, amount, method, status) VALUES 
  (1, 39999.88, 'mercadopago', 'approved');

-- Configuración visual de la tienda
INSERT INTO settings (logo_url, primary_color, secondary_color, store_name)
VALUES (
  'https://via.placeholder.com/120x40?text=Mi+Logo',
  '#4A90E2',
  '#F5F5F5',
  'Tienda Oficial Local'
);

SELECT tablename FROM pg_tables WHERE schemaname = 'public';
SELECT current_database();
