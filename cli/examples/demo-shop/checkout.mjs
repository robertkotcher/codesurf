import { reserve, release } from "./inventory.mjs";
import { charge } from "./payments.mjs";

// A checkout reserves stock before asking the payment provider to charge.
// Failed payments return the reserved stock so another customer can buy it.
export async function checkout(cart, paymentToken) {
  const reservation = reserve(cart);
  try {
    const receipt = await charge(reservation.total, paymentToken);
    return { status: "paid", reservation, receipt };
  } catch (error) {
    release(reservation);
    throw error;
  }
}

// The transport layer supplies a parsed cart and a payment token.
export async function handleCheckout(request) {
  return checkout(request.cart, request.paymentToken);
}
