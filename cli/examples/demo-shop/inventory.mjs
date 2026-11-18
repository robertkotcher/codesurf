const stock = new Map([
  ["coffee", { available: 12, price: 500 }],
  ["tea", { available: 8, price: 350 }],
]);

// Reservations contain integer prices in cents.
export function reserve(cart) {
  if (!cart.length) throw new Error("The cart is empty");
  const quantities = new Map();
  for (const { sku, quantity } of cart) {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a positive integer");
    }
    quantities.set(sku, (quantities.get(sku) || 0) + quantity);
  }
  const items = [...quantities].map(([sku, quantity]) => {
    const item = stock.get(sku);
    if (!item || quantity > item.available) {
      throw new Error("Not enough stock");
    }
    return { sku, quantity, price: item.price };
  });
  for (const { sku, quantity } of items) {
    stock.get(sku).available -= quantity;
  }
  return { items, total: items.reduce((sum, item) => sum + item.price * item.quantity, 0) };
}

export function release(reservation) {
  for (const { sku, quantity } of reservation.items) {
    stock.get(sku).available += quantity;
  }
}
