// Smoke test: start the server over stdio and call tools. Usage: node test/smoke.js [tool jsonArgs]...
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/server.js', import.meta.url).pathname] }));
const lines = Number(process.env.LINES || 12);
const calls = process.argv.length > 2
  ? process.argv.slice(2).reduce((a, x, i, arr) => (i % 2 ? a : [...a, [x, JSON.parse(arr[i + 1] || '{}')]]), [])
  : [['get_me', {}], ['list_chats', { limit: 5 }]];
if (process.argv.length <= 2) console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
for (const [name, args] of calls) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const out = res.content.map((c) => (c.type === 'text' ? c.text : `<${c.type} ${c.mimeType} ${c.data.length}b64>`)).join('\n').split('\n');
  console.log(`--- ${name} ${JSON.stringify(args)} ${res.isError ? 'ERROR ' : ''}(${Date.now() - t0}ms, ${out.length} lines)`);
  console.log(out.slice(0, lines).join('\n'));
}
await client.close();
