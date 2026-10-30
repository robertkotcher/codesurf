import http from "node:http";
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{font:18px system-ui;background:#f5f2eb;color:#242820;display:grid;place-items:center;min-height:95vh}main{width:400px;background:white;padding:48px;border-radius:16px}small{color:#657653}h1{font-size:36px}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;padding:14px;font:inherit;border:1px solid #bbc3b4;border-radius:6px}button{background:#324b35;color:white;margin-top:12px;cursor:pointer}#result{min-height:50px;font-size:16px}</style></head><body><main><small>FIELDNOTES / NEWSLETTER</small><h1>A little more outside.</h1><p>Stories for a slower, greener week.</p><form novalidate><label for="email">Email address</label><input id="email" name="email" placeholder="you@example.com"><button>Join the list</button></form><p id="result" role="status"></p></main><script>document.querySelector('form').onsubmit=e=>{e.preventDefault();const value=document.querySelector('#email').value.trim();console.log('Signup submitted');document.querySelector('#result').textContent=value?'You’re on the list. Welcome!':'Enter your email address.';};</script></body></html>`;
http
  .createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(html);
  })
  .listen(3000, "0.0.0.0", () =>
    console.log("Newsletter preview listening on http://localhost:3000"),
  );
