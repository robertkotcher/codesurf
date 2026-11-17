// A local demo provider. No network request is made.
export async function charge(amount, token) {
  if (token !== "demo-approved") {
    throw new Error("Payment declined");
  }
  return { id: "demo-receipt", amount };
}
