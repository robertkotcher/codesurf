// Collect the cart from the page and send it to the server.
const pay = document.getElementById("pay");
const result = document.getElementById("result");

pay.addEventListener("click", async () => {
  const cart = ["coffee", "tea"]
    .map((sku) => ({ sku, quantity: Number(document.getElementById(sku).value) }))
    .filter((item) => item.quantity > 0);
  const paymentToken = document.getElementById("card").value;
  const response = await fetch("/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart, paymentToken }),
  });
  const body = await response.json();
  result.className = response.ok ? "paid" : "error";
  result.textContent = response.ok
    ? `Paid $${(body.total / 100).toFixed(2)}`
    : `Payment failed: ${body.error}`;
});
