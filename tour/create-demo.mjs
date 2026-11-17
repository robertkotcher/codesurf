import fs from "node:fs";
const names = ["checkout", "inventory", "payments"];
const files = names.map((name) => ({
  id: name, path: `demo-shop/${name}.mjs`, language: "javascript",
  source: fs.readFileSync(new URL(`./demo-repo/${name}.mjs`, import.meta.url), "utf8"),
}));
const text = (text) => ({ text });
const ref = (text, card, first, last = first) => ({ text, target: { card, lines: [first, last] } });
const tour = {
  schemaVersion: 1,
  title: "Example PR review: checkout and payment recovery",
  review: { url: "https://example.com/demo-shop/pull/42", example: true },
  question: "This fictional PR adds checkout to a demo shop. Review the stock reservation, payment, and recovery paths.",
  revision: "bundled-demo-v1",
  files,
  cards: [
    { id: "entry", file: "checkout", title: "Checkout entry point", range: [1, 20], relevant: [[1, 2], [17, 20]],
      outlines: [{ name: "checkout(cart, paymentToken)", lines: [6, 15] }] },
    { id: "checkout", file: "checkout", title: "checkout(cart, paymentToken)", range: [3, 15], relevant: [[6, 15]] },
    { id: "reserve", file: "inventory", title: "reserve(cart)", range: [1, 27], relevant: [[6, 7], [16, 27]],
      outlines: [{ name: "Validate and combine cart quantities", lines: [8, 15] }] },
    { id: "charge", file: "payments", title: "charge(amount, token)", range: [1, 7], relevant: [[2, 7]] },
    { id: "release", file: "inventory", title: "release(reservation)", range: [29, 33], relevant: [[29, 33]] }
  ],
  connections: [
    { id: "start", from: { card: "entry", line: 19 }, to: { card: "checkout", line: 6 }, label: "Call checkout", kind: "call" },
    { id: "reserve-stock", from: { card: "checkout", line: 7 }, to: { card: "reserve", line: 7 }, label: "Reserve stock", kind: "call" },
    { id: "pay", from: { card: "checkout", line: 9 }, to: { card: "charge", line: 2 }, label: "Charge the total", kind: "call" },
    { id: "declined", from: { card: "charge", line: 4 }, to: { card: "checkout", line: 11 }, label: "Declined payment reaches catch", kind: "failure" },
    { id: "restore", from: { card: "checkout", line: 12 }, to: { card: "release", line: 29 }, label: "Restore reserved stock", kind: "failure" },
    { id: "paid", from: { card: "charge", line: 6 }, to: { card: "checkout", line: 10 }, label: "Return receipt", kind: "success" }
  ],
  steps: [
    { title: "Start with the checkout request",
      explanation: [text("This demo shop reserves items and charges the customer. The transport layer passes a parsed cart and payment token to "), ref("the public entry point", "entry", 17, 20), text(". Prices are integer cents.")],
      revealCards: ["entry"], revealConnections: [], focus: { card: "entry", lines: [17, 20] } },
    { title: "Coordinate stock and payment",
      explanation: [ref("The entry point calls checkout", "entry", 19), text(", which "), ref("reserves stock before charging", "checkout", 6, 10), text(". Its result contains the reservation and payment receipt.")],
      revealCards: ["checkout"], revealConnections: ["start"], focus: { card: "checkout", lines: [6, 10] } },
    { title: "Reserve available stock",
      explanation: [ref("reserve(cart)", "reserve", 6, 7), text(" validates quantities, combines duplicate items, and "), ref("checks availability", "reserve", 16, 22), text(". It then "), ref("subtracts stock and calculates the total", "reserve", 23, 26), text(".")],
      revealCards: ["reserve"], revealConnections: ["reserve-stock"], focus: { card: "reserve", lines: [23, 26] } },
    { title: "Ask the provider to charge",
      explanation: [text("The demo provider "), ref("receives the total and token", "charge", 1, 2), text(". An approved token produces a receipt. "), ref("Any other token throws an error", "charge", 3, 4), text(". This provider runs entirely locally.")],
      revealCards: ["charge"], revealConnections: ["pay"], focus: { card: "charge", lines: [2, 6] } },
    { title: "Recover from a declined payment",
      explanation: [ref("The payment error", "charge", 3, 4), text(" reaches "), ref("checkout’s catch block", "checkout", 11, 14), text(". Before rethrowing, it "), ref("returns every reserved item to stock", "release", 29, 33), text(".")],
      revealCards: ["release"], revealConnections: ["declined", "restore"], focus: { card: "checkout", lines: [11, 14] } },
    { title: "Return a successful checkout",
      explanation: [text("When payment succeeds, "), ref("the provider returns a receipt", "charge", 6), text(" and checkout "), ref("returns the paid result", "checkout", 9, 10), text(". The reservation stays deducted from stock.")],
      revealCards: [], revealConnections: ["paid"], focus: { card: "checkout", lines: [9, 10] } }
  ]
};
fs.writeFileSync(new URL("./example.json", import.meta.url), JSON.stringify(tour, null, 2) + "\n");
