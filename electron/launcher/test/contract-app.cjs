// App falso que segue o contrato do hub, para os testes do ProcessManager.
// Argumentos: --server.port=<porta> (obrigatório), --marker=<arquivo> (gravado ao fechar
// direito), --ignore-shutdown (aceita o pedido mas não fecha). Token em TEST_APP_TOKEN.
const http = require('node:http');
const fs = require('node:fs');

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(arg('server.port'));
const marker = arg('marker');
const ignoreShutdown = process.argv.includes('--ignore-shutdown');
const token = process.env.TEST_APP_TOKEN;

let ready = false;
setTimeout(() => (ready = true), 300);

const server = http.createServer((req, res) => {
  if (req.url === '/actuator/health/readiness') {
    res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ready ? 'UP' : 'OUT_OF_SERVICE' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/actuator/shutdown') {
    if (!token || req.headers['x-mycollection-token'] !== token) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end('{"code":"request.invalid-token"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"message":"Shutting down, bye..."}');
    if (!ignoreShutdown) {
      setTimeout(() => {
        if (marker) fs.writeFileSync(marker, 'fechou direito');
        process.exit(0);
      }, 100);
    }
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<p>app de teste</p>');
});
server.listen(port, '127.0.0.1');
console.log(`app de teste ouvindo em ${port}`);
