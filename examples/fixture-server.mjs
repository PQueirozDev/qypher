import http from 'node:http';
const server = http.createServer((req, res) => {
  if (req.url === '/slow') { const timer = setTimeout(() => { res.writeHead(200); res.end('slow'); }, 15000); res.on('close', () => clearTimeout(timer)); return; }
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/' }); res.end(); return; }
  if (req.url === '/outside') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); res.end(); return; }
  if (req.url === '/hardened') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=()', 'Set-Cookie': 'fixture=local-test-only; Secure; HttpOnly; SameSite=Strict' }); res.end('Controlled hardened fixture (HTTP intentionally).'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Server': 'Qypher-fixture', 'Set-Cookie': 'fixture=local-test-only; SameSite=None', 'Access-Control-Allow-Origin': '*' });
  res.end('<!doctype html><html lang="pt-BR"><title>Qypher fixture</title><h1>Fixture local autorizada</h1><p>Configurações HTTP propositalmente incompletas para testes. Não use em produção.</p></html>');
});
server.listen(8877, '127.0.0.1', () => console.log('Qypher fixture: http://127.0.0.1:8877/ (loopback only). Ctrl+C stops. /slow /redirect /outside /hardened'));
